/**
 * 템플릿 — 순수 함수.
 * - 블록 템플릿: 채널 묶음. 원하는 위치에 끼워 넣으면 채널 번호와 패치를 위 채널에 이어서 매긴다.
 * - Show 템플릿: 스테이지박스·아웃풋·DCA·뮤트(필요하면 인풋까지)를 포함한 Show 전체 틀.
 * 기본 제공 블록은 내 소스 목록을 가리키므로, 넣을 때 그 소스의 짧은 이름·컬러·추천 마이크(보유 장비 먼저)가 들어간다.
 */
import { applyPreset } from "./busPresets";
import { createEmptyShow, newId } from "./factory";
import { newChannel, renumberSequential, withInputs } from "./inputOps";
import {
  channelsOf,
  ensureShowMic,
  micOptions,
  type BlockTemplate,
  type Library,
  type ShowTemplate,
  type TemplateChannel,
} from "./library";
import { busAccess, rowOps } from "./outputOps";
import type { BusKind, InputChannel, Microphone, PortRef, Show } from "./schema";
import { BUS_PRESETS } from "./busPresets";
import { norm } from "./text";

/* ───────────── 기본 제공 블록 ───────────── */

export interface BuiltinBlock {
  id: string;
  name: string;
  /** 소스 id들 (스테레오 소스는 두 채널) */
  sources: string[];
  /** 이 블록 채널이 들어갈 DCA 이름 */
  dca?: string;
}

export const BUILTIN_BLOCKS: BuiltinBlock[] = [
  {
    id: "drums-8",
    name: "드럼 8ch",
    sources: ["src-kick-in", "src-snare-top", "src-hihat", "src-tom1", "src-tom2", "src-ftom", "src-oh"],
    dca: "Drums",
  },
  {
    id: "drums-12",
    name: "드럼 12ch",
    sources: [
      "src-kick-in", "src-kick-out", "src-snare-top", "src-snare-btm", "src-hihat",
      "src-tom1", "src-tom2", "src-tom3", "src-ftom", "src-ride", "src-oh",
    ],
    dca: "Drums",
  },
  { id: "bass", name: "베이스 DI+Mic", sources: ["src-bass-di", "src-bass-mic"], dca: "Bass" },
  { id: "keys", name: "키보드 스테레오", sources: ["src-keys"], dca: "Keys" },
  { id: "vox-4", name: "보컬 4", sources: ["src-lead-vox", "src-cho1", "src-cho2", "src-cho3"], dca: "Vox" },
  { id: "choir-oh", name: "합창 오버헤드", sources: ["src-choir-oh"], dca: "Choir" },
  { id: "mr", name: "MR 스테레오", sources: ["src-mr"], dca: "MR" },
  { id: "mc", name: "사회자", sources: ["src-mc1", "src-mc2"], dca: "MC" },
];

/** 기본 블록 → 템플릿 채널 (지금의 내 소스 목록과 보유 장비 기준) */
export function resolveBuiltin(block: BuiltinBlock, lib: Library, show: Show): TemplateChannel[] {
  return block.sources.flatMap((id) => {
    const src = lib.sources.find((s) => s.id === id);
    if (!src) return [];
    const mic = micOptions(lib, show, src).recommended[0]?.mic;
    const chs = channelsOf(src, src.numbered ? 1 : undefined);
    return chs.map((c, k) => ({
      source: c.source,
      shortName: c.shortName,
      performer: "",
      mic: mic ? { id: mic.id, model: mic.model, type: mic.type, needsPhantom: mic.needsPhantom, defaultStand: mic.defaultStand } : null,
      customMic: "",
      stand: null,
      phantom: null,
      stereoLinkNext: chs.length === 2 && k === 0,
      color: src.color,
      dcas: block.dca ? [block.dca] : [],
      mutes: [],
      notes: "",
    }));
  });
}

/* ───────────── Show → 템플릿 ───────────── */

export function toTemplateChannels(show: Show, rows: number[]): TemplateChannel[] {
  const mics = new Map(show.microphones.map((m) => [m.id, m]));
  const dcaName = (id: string) => {
    const d = show.dcas.find((x) => x.id === id);
    return d ? d.name || `DCA ${d.number}` : "";
  };
  const muteName = (id: string) => {
    const g = show.muteGroups.find((x) => x.id === id);
    return g ? g.name || `Mute ${g.number}` : "";
  };
  return rows
    .map((r) => show.inputs[r])
    .filter(Boolean)
    .map((c, k, arr) => ({
      source: c.source,
      shortName: c.shortName,
      performer: c.performer,
      mic: c.mic?.kind === "library" ? (mics.get(c.mic.microphoneId) ?? null) : null,
      customMic: c.mic?.kind === "custom" ? c.mic.name : "",
      stand: c.stand,
      phantom: c.phantom,
      // 묶음의 마지막 채널이 묶음 밖과 링크돼 있으면 끊는다
      stereoLinkNext: c.stereoLinkNext && k < arr.length - 1,
      color: c.color,
      dcas: c.dcaIds.map(dcaName).filter(Boolean),
      mutes: c.muteGroupIds.map(muteName).filter(Boolean),
      notes: c.notes,
    }));
}

export function makeBlockTemplate(name: string, channels: TemplateChannel[]): BlockTemplate {
  return { id: newId(), name: name.trim(), channels };
}

export function makeShowTemplate(name: string, show: Show): ShowTemplate {
  return { id: newId(), name: name.trim(), show: structuredClone(show) };
}

/* ───────────── 블록 삽입 ───────────── */

/** 마이크 사본을 Show에 넣는다: 내 라이브러리에 있으면 그 최신 사양, 없으면 템플릿의 사본 */
function placeMic(show: Show, lib: Library | null, snap: Microphone): { show: Show; id: string } {
  const lm = lib?.microphones.find((m) => m.id === snap.id) ?? lib?.microphones.find((m) => norm(m.model) === norm(snap.model));
  if (lm) return ensureShowMic(show, lm);
  const same = show.microphones.find((m) => m.id === snap.id && m.model === snap.model) ?? show.microphones.find((m) => norm(m.model) === norm(snap.model));
  if (same) return { show, id: same.id };
  const id = show.microphones.some((m) => m.id === snap.id) ? newId() : snap.id;
  return { show: { ...show, microphones: [...show.microphones, { ...snap, id }] }, id };
}

/** 이름으로 DCA·뮤트 그룹 찾기, 없으면 다음 번호로 만들기 */
function groupIds(show: Show, key: "dcas" | "muteGroups", names: string[]): { show: Show; ids: string[] } {
  let list = show[key];
  const ids: string[] = [];
  for (const name of names) {
    let g = list.find((x) => norm(x.name) === norm(name));
    if (!g) {
      g = { id: newId(), number: list.reduce((m, x) => Math.max(m, x.number), 0) + 1, name };
      list = [...list, g];
    }
    if (!ids.includes(g.id)) ids.push(g.id);
  }
  return { show: list === show[key] ? show : { ...show, [key]: list }, ids };
}

/**
 * 이어서 쓸 빈 인풋 포트들: 위쪽에서 마지막으로 패치된 채널의 박스·포트 다음부터,
 * 그 박스가 차면 다음 박스로. 위에 패치된 채널이 없으면 첫 박스 1번부터.
 */
export function nextFreePorts(show: Show, at: number, count: number): (PortRef | null)[] {
  const used = new Set(
    show.inputs.flatMap((c) => (c.port?.kind === "stagebox" ? [`${c.port.stageBoxId}:${c.port.port}`] : [])),
  );
  let startBox = 0;
  let startPort = 1;
  for (let i = Math.min(at, show.inputs.length) - 1; i >= 0; i--) {
    const p = show.inputs[i].port;
    if (p?.kind === "stagebox") {
      const bi = show.stageBoxes.findIndex((b) => b.id === p.stageBoxId);
      if (bi >= 0) {
        startBox = bi;
        startPort = p.port + 1;
        break;
      }
    }
  }
  const out: (PortRef | null)[] = [];
  const boxes = show.stageBoxes;
  // 시작 박스의 남은 포트 → 그 뒤 박스들 → 앞쪽 박스들 → 시작 박스의 앞부분
  const order: [number, number][] = [];
  for (let k = 0; k < boxes.length; k++) order.push([(startBox + k) % boxes.length, k === 0 ? startPort : 1]);
  if (boxes.length) order.push([startBox, 1]);
  for (const [bi, from] of order) {
    const box = boxes[bi];
    for (let p = from; p <= box.inputs && out.length < count; p++) {
      const k = `${box.id}:${p}`;
      if (used.has(k)) continue;
      used.add(k);
      out.push({ kind: "stagebox", stageBoxId: box.id, port: p });
    }
    if (out.length >= count) break;
  }
  while (out.length < count) out.push(null);
  return out;
}

/**
 * at 행 앞에 템플릿 채널들을 끼워 넣는다 (at = 행 수면 맨 끝).
 * 번호: renumber면 전체를 1..n으로, 아니면 위 채널 번호 다음부터 비어 있는 번호로.
 * 패치: nextFreePorts. 반환: 새 Show와 들어간 행 범위.
 */
export function insertBlock(
  show: Show,
  lib: Library | null,
  channels: TemplateChannel[],
  at: number,
  renumber: boolean,
): { show: Show; from: number; to: number } {
  if (!channels.length) return { show, from: at, to: at - 1 };
  at = Math.max(0, Math.min(at, show.inputs.length));
  let s = show;
  const ports = nextFreePorts(s, at, channels.length);
  const taken = new Set(s.inputs.map((c) => c.number));
  let num = (s.inputs[at - 1]?.number ?? 0) + 1;
  const made: InputChannel[] = [];
  channels.forEach((t, k) => {
    let mic: InputChannel["mic"] = null;
    if (t.mic) {
      const r = placeMic(s, lib, t.mic);
      s = r.show;
      mic = { kind: "library", microphoneId: r.id };
    } else if (t.customMic) mic = { kind: "custom", name: t.customMic };
    const d = groupIds(s, "dcas", t.dcas);
    s = d.show;
    const m = groupIds(s, "muteGroups", t.mutes);
    s = m.show;
    while (taken.has(num)) num++;
    taken.add(num);
    made.push({
      ...newChannel(num++),
      source: t.source,
      shortName: t.shortName,
      performer: t.performer,
      mic,
      stand: t.stand,
      phantom: t.phantom,
      port: ports[k],
      stereoLinkNext: t.stereoLinkNext,
      color: t.color,
      dcaIds: d.ids,
      muteGroupIds: m.ids,
      notes: t.notes,
    });
  });
  const inputs = s.inputs.slice();
  inputs.splice(at, 0, ...made);
  s = withInputs(s, renumber ? renumberSequential(inputs) : inputs);
  return { show: s, from: at, to: at + made.length - 1 };
}

/* ───────────── Show 템플릿 ───────────── */

/** 템플릿으로 새 Show: id·시각·제목만 새로 */
export function showFromTemplate(t: ShowTemplate, title?: string): Show {
  const now = new Date().toISOString();
  return { ...structuredClone(t.show), id: newId(), title: title ?? t.show.title, createdAt: now, updatedAt: now };
}

function withBuses(show: Show, kind: BusKind, ids: string[]): Show {
  const ops = rowOps(busAccess(kind));
  let s = show;
  for (const id of ids) {
    const row = ops.count(s);
    s = applyPreset(ops.append(s), kind, row, BUS_PRESETS[kind].find((p) => p.id === id)!);
  }
  return s;
}

function withGroups(show: Show, dcas: string[], mutes: string[]): Show {
  return {
    ...show,
    dcas: dcas.map((name, i) => ({ id: newId(), number: i + 1, name })),
    muteGroups: mutes.map((name, i) => ({ id: newId(), number: i + 1, name })),
  };
}

/** 기본 제공 Show 템플릿 (인풋은 비워 두고 블록 템플릿으로 채운다) */
export const BUILTIN_SHOW_TEMPLATES: { id: string; name: string; description: string; build(): Show }[] = [
  {
    id: "band",
    name: "밴드 공연 기본 틀",
    description: "Rio3224+Rio1608 · Aux: 웨지 6, IEM 2, Reverb 2, Delay · Matrix: 프런트필, 딜레이, 녹음 · DCA 6",
    build() {
      let s = createEmptyShow("새 밴드 공연");
      s = withBuses(s, "aux", ["wedge", "wedge", "wedge", "wedge", "wedge", "wedge", "iem", "iem", "reverb", "reverb", "delay"]);
      s = withBuses(s, "matrix", ["front-fill", "delay-spk", "mtx-rec"]);
      return withGroups(s, ["Drums", "Bass", "Gtr", "Keys", "Vox", "FX"], ["Band", "Vox", "MC"]);
    },
  },
  {
    id: "event",
    name: "행사·사회 기본 틀",
    description: "Rio3224+Rio1608 · Aux: 웨지 2, Reverb · Matrix: 로비, 녹음, 중계 · DCA: MC, MR, Band",
    build() {
      let s = createEmptyShow("새 행사");
      s = withBuses(s, "aux", ["wedge", "wedge", "reverb"]);
      s = withBuses(s, "matrix", ["lobby", "mtx-rec", "mtx-bcast"]);
      return withGroups(s, ["MC", "MR", "Band"], ["MC", "MR", "Band"]);
    },
  },
];
