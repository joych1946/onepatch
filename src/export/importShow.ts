/**
 * 콘솔 상태(ConsoleSnapshot) → Show. 기종 중립 (DM7 읽기는 src/export/dm7/dm7Import.ts).
 * - showFromSnapshot: 새 Show 만들기. 이름으로 소스 목록을 찾아 소스명을 채우고, 못 찾으면 이름 그대로.
 * - diffSnapshot / applyImportChanges: "콘솔 변경분 가져오기" — 기존 Show와 달라진 것만 골라 반영.
 * 파일에 없는 정보(마이크, 스탠드, 연주자, 비고)는 새 Show에서는 비워 두고, 기존 Show에서는 건드리지 않는다.
 */
import type { BusKind, Color, InputChannel, OutputBus, PortRef, Show } from "@/model/schema";
import { channelsOf, type SourceDef, type SourceGroup } from "@/model/library";
import { LEGACY_SHORT_NAMES } from "@/model/libraryDefaults";
import { newId } from "@/model/factory";
import { newChannel } from "@/model/inputOps";
import { busesOf, newBus } from "@/model/outputOps";
import { findPreset } from "@/model/busPresets";
import { resolvePhantom } from "@/model/derive";
import { COLOR_LABEL, formatPort } from "@/model/labels";
import { norm } from "@/model/text";
import { consoleColor } from "./profile";
import type { ConsoleSnapshot, SnapshotBus, SnapshotChannel } from "./dm7/dm7Import";
import { allocateBuses } from "./dm7/dm7Export";

/* ───────────── 소스 목록 찾기 ───────────── */

export interface SourceMatch {
  source: string;
  sourceDef: SourceDef;
  groupName: string;
}

/** 콘솔 이름("KICK IN", "OH L", "Gaya2")으로 소스 목록 항목 찾기 */
export function matchSource(name: string, sources: readonly SourceDef[], groups: readonly SourceGroup[] = []): SourceMatch | null {
  const t = name.trim();
  if (!t) return null;
  const m = t.match(/^(.*?)\s*((?:\d+|[LR])(?:\s*[LR])?)$/i);
  const tries: [string, string][] = [[t, ""]];
  if (m && m[1]) tries.push([m[1], m[2].replace(/\s+/g, " ")]);
  for (const [key, suffix] of tries) {
    const k = norm(key);
    // 한글 이름·영문 이름·짧은 이름·예전 기본 짧은 이름("Gaya")
    const src = sources.find(
      (s) => norm(s.name) === k || norm(s.nameEn) === k || norm(s.shortName) === k || (LEGACY_SHORT_NAMES[s.id] ?? []).some((x) => norm(x) === k),
    );
    if (src) {
      const sep = /^\d/.test(suffix) && /\d$/.test(src.name) ? "-" : " ";
      return { source: suffix ? `${src.name}${sep}${suffix}` : src.name, sourceDef: src, groupName: groups.find((g) => g.id === src.groupId)?.name ?? "" };
    }
  }
  // 8자에 맞추느라 줄어든 번호 붙은 짧은 이름("Gayagem2", "JangGng1"): 같은 규칙으로 만들어 비교
  const num = t.match(/^(.*?)\s*(\d+)$/);
  if (num) {
    const n = parseInt(num[2], 10);
    for (const src of sources) {
      if (!src.numbered) continue;
      if (channelsOf(src, n).some((c) => norm(c.shortName) === norm(t)))
        return { source: channelsOf(src, n)[0].source, sourceDef: src, groupName: groups.find((g) => g.id === src.groupId)?.name ?? "" };
    }
  }
  return null;
}

/** 패치를 옮기지 못한 채널을 종류별 한 줄로 */
export function channelNotes(channels: readonly SnapshotChannel[]): string[] {
  const ch = (k: SnapshotChannel["portIssue"]) => channels.filter((c) => c.portIssue === k);
  const out: string[] = [];
  const range = ch("dante-range");
  if (range.length)
    out.push(`Ch ${range.map((c) => c.number).join(", ")}: ${range.map((c) => c.portLabel).join(", ")}가 어느 스테이지박스 범위에도 없어 패치를 비웠습니다 (박스 구성·Dante 시작 번호 확인).`);
  const unknown = ch("unknown");
  if (unknown.length) out.push(`Ch ${unknown.map((c) => c.number).join(", ")}: OnePatch가 모르는 패치 소스(Dante·OMNI 외)라 패치를 비웠습니다.`);
  return out;
}

/* ───────────── 새 Show ───────────── */

export interface ImportOptions {
  /** 기본 이름 그대로인 채널·버스는 건너뛴다 */
  skipDefault: boolean;
  sources?: readonly SourceDef[];
  groups?: readonly SourceGroup[];
}

const portKey = (p: PortRef | null | undefined) =>
  !p ? "" : p.kind === "stagebox" ? `b:${p.stageBoxId}:${p.port}` : p.kind === "local" ? `l:${p.port}` : p.kind === "dante" ? `d:${p.port}` : `o:${p.label}`;
const samePort = (a: PortRef | null | undefined, b: PortRef | null | undefined) => portKey(a) === portKey(b);

function busFrom(b: SnapshotBus, number: number, keepName?: string): OutputBus {
  const bus = newBus(b.kind, number);
  const name = b.isDefault && keepName !== undefined ? keepName : b.name;
  const preset = findPreset(b.kind, name)?.preset;
  return {
    ...bus,
    name,
    width: b.width,
    purpose: preset?.purpose ?? (b.kind === "main" ? (b.width === "stereo" ? "pa" : "sub") : bus.purpose),
    tap: preset?.tap ?? bus.tap,
    ports: b.ports,
  };
}

function channelFrom(c: SnapshotChannel, opts: Pick<ImportOptions, "sources" | "groups">, dcaId: (n: number) => string, muteId: (n: number) => string): InputChannel {
  const match = matchSource(c.name, opts.sources ?? [], opts.groups ?? []);
  return {
    ...newChannel(c.number),
    source: match?.source ?? c.name,
    shortName: c.name,
    color: c.color,
    port: c.port,
    phantom: c.phantom,
    stereoLinkNext: c.pairNext,
    dcaIds: c.dca.map(dcaId),
    muteGroupIds: c.mute.map(muteId),
  };
}

/** base: 새 Show의 틀 (제목·스테이지박스 — 읽을 때 쓴 박스와 같아야 한다) */
export function showFromSnapshot(snap: ConsoleSnapshot, base: Show, opts: ImportOptions): { show: Show; matches: Map<number, SourceMatch> } {
  const keep = <T extends { isDefault: boolean }>(x: T) => !opts.skipDefault || !x.isDefault;
  const channels = snap.channels.filter(keep);
  const usedDca = new Set(channels.flatMap((c) => c.dca));
  const usedMute = new Set(channels.flatMap((c) => c.mute));
  const dcas = snap.dcas.filter((d) => usedDca.has(d.number) || !d.isDefault).map((d) => ({ id: newId(), number: d.number, name: d.isDefault ? "" : d.name }));
  const mutes = snap.mutes.filter((g) => usedMute.has(g.number) || !g.isDefault).map((g) => ({ id: newId(), number: g.number, name: g.isDefault ? "" : g.name }));
  const id = (list: { id: string; number: number }[]) => (n: number) => list.find((x) => x.number === n)!.id;
  const inputs = channels.map((c) => channelFrom(c, opts, id(dcas), id(mutes)));
  const matches = new Map<number, SourceMatch>();
  for (const c of channels) {
    const m = matchSource(c.name, opts.sources ?? [], opts.groups ?? []);
    if (m) matches.set(c.number, m);
  }
  const baseMains = busesOf(base, "main");
  const outputs: OutputBus[] = [];
  for (const kind of ["aux", "matrix"] as BusKind[]) snap.buses.filter((b) => b.kind === kind && keep(b)).forEach((b, i) => outputs.push(busFrom(b, i + 1)));
  snap.buses
    .filter((b) => b.kind === "main" && (b.consoleNumber === 1 || keep(b)))
    .forEach((b, i) => outputs.push(busFrom(b, i + 1, baseMains[i]?.name ?? "")));
  return { show: { ...base, inputs, outputs, dcas, muteGroups: mutes, microphones: [] }, matches };
}

/* ───────────── 콘솔 변경분 ───────────── */

type ChSet = Partial<Pick<InputChannel, "shortName" | "color" | "port" | "phantom" | "stereoLinkNext">>;
export type ImportPatch =
  | { t: "ch"; number: number; set: ChSet }
  | { t: "chDca"; number: number; nums: number[] }
  | { t: "chMute"; number: number; nums: number[] }
  | { t: "addCh"; ch: SnapshotChannel }
  | { t: "bus"; busId: string; set: Partial<Pick<OutputBus, "name" | "ports">> }
  | { t: "addBus"; bus: SnapshotBus }
  | { t: "dcaName"; number: number; name: string }
  | { t: "muteName"; number: number; name: string };

export interface ImportChange {
  key: string;
  /** 묶음 (Ch 3, Mix 1, DCA 2 …) */
  target: string;
  field: string;
  before: string;
  after: string;
  patch: ImportPatch;
}

const portText = (show: Show, p: PortRef | null | undefined) =>
  !p ? "없음" : formatPort(p, show.stageBoxes);
const list = (n: number[]) => (n.length ? n.join(", ") : "—");
const fit = (s: string, max: number) => [...s.trim()].slice(0, max).join("").trimEnd();

/** 기존 Show와 콘솔 파일의 차이 (Show에 반영할 수 있는 것만) */
export function diffSnapshot(show: Show, snap: ConsoleSnapshot): ImportChange[] {
  const P = snap.profile;
  const out: ImportChange[] = [];
  const add = (target: string, field: string, before: string, after: string, patch: ImportPatch) =>
    out.push({ key: `${target}|${field}`, target, field, before, after, patch });
  const dcaNum = (id: string) => show.dcas.find((d) => d.id === id)?.number ?? 0;
  const muteNum = (id: string) => show.muteGroups.find((g) => g.id === id)?.number ?? 0;
  const byNum = new Map(show.inputs.map((c) => [c.number, c]));

  for (const s of snap.channels) {
    const c = byNum.get(s.number);
    const t = `Ch ${s.number}`;
    if (!c) {
      if (!s.isDefault) add(t, "새 채널", "—", `${s.name} (${s.portLabel})`, { t: "addCh", ch: s });
      continue;
    }
    const name = fit(c.shortName || c.source, P.nameMax);
    if (name !== s.name && !(s.isDefault && !name)) add(t, "이름", name || "—", s.name, { t: "ch", number: s.number, set: { shortName: s.name } });
    const cur = consoleColor(P, c.color)?.value;
    if (s.color !== "none" && cur !== s.colorValue && !(c.color === "none" && s.isDefault))
      add(t, "컬러", c.color === "none" ? "없음" : COLOR_LABEL[c.color], COLOR_LABEL[s.color], { t: "ch", number: s.number, set: { color: s.color as Color } });
    const portKnown = s.port !== null || s.portLabel === "없음";
    const curPort = c.port?.kind === "other" ? undefined : c.port;
    if (portKnown && c.port?.kind !== "other" && !samePort(curPort, s.port))
      add(t, "패치", portText(show, c.port), portText(show, s.port), { t: "ch", number: s.number, set: { port: s.port } });
    if (s.phantom !== null && samePort(c.port, s.port) && resolvePhantom(show, c) !== s.phantom)
      add(t, "48V", resolvePhantom(show, c) ? "켜짐" : "꺼짐", s.phantom ? "켜짐" : "꺼짐", { t: "ch", number: s.number, set: { phantom: s.phantom } });
    if (c.stereoLinkNext !== s.pairNext) add(t, "페어", c.stereoLinkNext ? `${s.number}–${s.number + 1}` : "단독", s.pairNext ? `${s.number}–${s.number + 1}` : "단독", { t: "ch", number: s.number, set: { stereoLinkNext: s.pairNext } });
    const dcas = c.dcaIds.map(dcaNum).filter(Boolean).sort((a, b) => a - b);
    if (list(dcas) !== list(s.dca)) add(t, "DCA", list(dcas), list(s.dca), { t: "chDca", number: s.number, nums: s.dca });
    const mutes = c.muteGroupIds.map(muteNum).filter(Boolean).sort((a, b) => a - b);
    if (list(mutes) !== list(s.mute)) add(t, "뮤트", list(mutes), list(s.mute), { t: "chMute", number: s.number, nums: s.mute });
  }

  // 버스: 내보내기와 같은 배정으로 맞춘다
  const noop = () => {};
  const alloc = allocateBuses(show, { warn: noop, note: noop }, P);
  const seen = new Set<SnapshotBus>();
  for (const a of alloc) {
    const s = snap.buses.find((b) =>
      a.bus.kind === "main" ? b.kind === "main" && b.label === a.label : b.kind === a.bus.kind && b.label.split(" ")[1]?.split("/")[0] === a.label.split(" ")[1]?.split("/")[0],
    );
    if (!s) continue;
    seen.add(s);
    const t = `${a.label} ${a.bus.name}`.trim();
    if (!s.isDefault && fit(a.bus.name, P.nameMax) !== s.name) add(t, "이름", a.bus.name || "—", s.name, { t: "bus", busId: a.bus.id, set: { name: s.name } });
    const mine = a.bus.ports.filter((p) => p.kind !== "other");
    const theirs = a.bus.width === "stereo" || s.width === "stereo" ? s.ports.slice(0, 2) : s.ports;
    const cmp = a.bus.width === "stereo" ? mine.slice(0, 2) : mine;
    if (theirs.length && (cmp.length !== theirs.length || cmp.some((p, i) => !samePort(p, theirs[i]))))
      add(t, "출력 패치", cmp.map((p) => portText(show, p)).join(", ") || "없음", theirs.map((p) => portText(show, p)).join(", "), {
        t: "bus",
        busId: a.bus.id,
        set: { ports: [...theirs, ...a.bus.ports.filter((p) => p.kind === "other")] },
      });
  }
  for (const b of snap.buses) if (!seen.has(b) && !b.isDefault && b.kind !== "main") add(b.label, "새 버스", "—", `${b.name}${b.width === "stereo" ? " (스테레오)" : ""}`, { t: "addBus", bus: b });

  for (const d of snap.dcas) {
    if (d.isDefault) continue;
    const cur = show.dcas.find((x) => x.number === d.number);
    if (fit(cur?.name ?? "", P.nameMax) !== d.name) add(`DCA ${d.number}`, "이름", cur?.name || "—", d.name, { t: "dcaName", number: d.number, name: d.name });
  }
  for (const g of snap.mutes) {
    if (g.isDefault) continue;
    const cur = show.muteGroups.find((x) => x.number === g.number);
    if (fit(cur?.name ?? "", P.nameMax) !== g.name) add(`뮤트 그룹 ${g.number}`, "이름", cur?.name || "—", g.name, { t: "muteName", number: g.number, name: g.name });
  }
  return out;
}

/** 고른 변경만 Show에 반영 (마이크·스탠드·연주자·비고는 건드리지 않음) */
export function applyImportChanges(show: Show, changes: readonly ImportChange[], snap: ConsoleSnapshot, opts: Pick<ImportOptions, "sources" | "groups"> = {}): Show {
  let s = show;
  const ensure = (coll: "dcas" | "muteGroups", n: number): string => {
    const found = s[coll].find((x) => x.number === n);
    if (found) return found.id;
    const src = (coll === "dcas" ? snap.dcas : snap.mutes).find((x) => x.number === n);
    const item = { id: newId(), number: n, name: src && !src.isDefault ? src.name : "" };
    s = { ...s, [coll]: [...s[coll], item].sort((a, b) => a.number - b.number) };
    return item.id;
  };
  const setCh = (n: number, fn: (c: InputChannel) => InputChannel) => (s = { ...s, inputs: s.inputs.map((c) => (c.number === n ? fn(c) : c)) });
  for (const { patch: p } of changes) {
    switch (p.t) {
      case "ch":
        setCh(p.number, (c) => ({ ...c, ...p.set }));
        break;
      case "chDca": {
        const ids = p.nums.map((n) => ensure("dcas", n));
        setCh(p.number, (c) => ({ ...c, dcaIds: ids }));
        break;
      }
      case "chMute": {
        const ids = p.nums.map((n) => ensure("muteGroups", n));
        setCh(p.number, (c) => ({ ...c, muteGroupIds: ids }));
        break;
      }
      case "addCh": {
        const ch = channelFrom(p.ch, opts, (n) => ensure("dcas", n), (n) => ensure("muteGroups", n));
        s = { ...s, inputs: [...s.inputs, ch].sort((a, b) => a.number - b.number) };
        break;
      }
      case "bus":
        s = { ...s, outputs: s.outputs.map((b) => (b.id === p.busId ? { ...b, ...p.set } : b)) };
        break;
      case "addBus": {
        const n = busesOf(s, p.bus.kind).length + 1;
        s = { ...s, outputs: [...s.outputs, busFrom(p.bus, n)] };
        break;
      }
      case "dcaName": {
        const id = ensure("dcas", p.number);
        s = { ...s, dcas: s.dcas.map((d) => (d.id === id ? { ...d, name: p.name } : d)) };
        break;
      }
      case "muteName": {
        const id = ensure("muteGroups", p.number);
        s = { ...s, muteGroups: s.muteGroups.map((g) => (g.id === id ? { ...g, name: p.name } : g)) };
        break;
      }
    }
  }
  return s;
}
