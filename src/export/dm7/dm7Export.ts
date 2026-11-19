/**
 * OnePatch Show → Yamaha DM7 쇼 파일 고쳐 쓰기.
 *
 * 사용자가 DM Editor에서 저장한 파일(.dmxf)을 받아, 인풋 채널의
 * 이름·컬러·아이콘·패치·48V·페어·DCA·뮤트 그룹만 바꾼다. 나머지(EQ, 다이내믹스, 네트워크 등)는 그대로 둔다.
 * 콘솔에 종속된 값(컬러 이름, 소스 번호, 아이콘 이름)은 모두 이 파일 안에만 둔다.
 *
 * 형식 근거: docs/research/dm7.md (Yamaha 비공개 형식 — 샘플 비교로 확인한 범위만 쓴다)
 */
import { resolvePhantom } from "@/model/derive";
import type { BusKind, Color, OutputBus, PortRef, Show } from "@/model/schema";
import type { SourceDef } from "@/model/library";
import { busesOf } from "@/model/outputOps";
import { consoleColor, DEFAULT_CONSOLE_PROFILE, profileByModel, type ConsoleProfile } from "../profile";
import { pickIcon } from "../icons";
import { blockData, findBlock, type Dm7File } from "./container";
import {
  locate,
  parseSections,
  readBit,
  readString,
  readUint,
  section,
  writeBit,
  writeString,
  writeUint,
  type MbdfSection,
} from "./mbdf";

/** 스키마의 Omni 인풋 포트 수 (파일 형식 값. 기종 한도는 콘솔 프로필) */
const DM7_OMNI_COUNT = 32;

/* ───────────── 설정 ───────────── */

export type Dm7Item = "name" | "color" | "icon" | "patch" | "phantom" | "pair" | "dca" | "mute" | "outPatch" | "busNames";
export const DM7_ITEMS: { key: Dm7Item; label: string; note?: string }[] = [
  { key: "name", label: "이름", note: "짧은 이름(없으면 소스명), 8자" },
  { key: "color", label: "컬러" },
  { key: "icon", label: "아이콘", note: "소스 목록·소스명으로 자동, 맞는 것이 없으면 Blank" },
  { key: "patch", label: "인풋 패치", note: "Bank A" },
  { key: "phantom", label: "48V", note: "포트 단위" },
  { key: "pair", label: "스테레오 페어" },
  { key: "dca", label: "DCA 배정" },
  { key: "mute", label: "뮤트 그룹 배정" },
  { key: "outPatch", label: "아웃풋 패치", note: "Mix·Matrix·Stereo → OMNI/Dante OUT" },
  { key: "busNames", label: "버스·DCA·뮤트 그룹 이름", note: "8자" },
];

export interface Dm7BoxSetting {
  /** 이 박스의 1번 포트가 들어오는 DM7 Dante 입력 번호 (비우면 패치하지 않음) */
  danteStart: number | null;
  /** 48V를 쓸 Dante I/O 유닛 번호 1–24 (비우면 48V를 쓰지 않음) */
  ioUnit: number | null;
  /** 이 박스의 1번 출력이 받는 DM7 Dante OUT 번호 (비우면 출력 패치하지 않음) */
  danteOutStart?: number | null;
}

export interface Dm7Options {
  items: Record<Dm7Item, boolean>;
  boxes: Record<string, Dm7BoxSetting>;
  /** 아웃풋 패치: OnePatch가 다루는 출력 포트(OMNI OUT, 박스의 Dante OUT 범위) 중 쓰지 않는 포트는 "없음"으로 */
  clearUnusedOutputs?: boolean;
  /** 콘솔에 없는 OnePatch 컬러를 사용자가 고른 콘솔 컬러로 (점검 화면에서 확인) */
  colorMap?: Partial<Record<Color, string>>;
}

/** 계획에 쓰는 바깥 정보 (아이콘: 내 소스 목록) */
export interface Dm7Context {
  sources?: readonly SourceDef[];
}

export function defaultDm7Options(show: Show): Dm7Options {
  let next = 1;
  let nextOut = 1;
  const boxes: Record<string, Dm7BoxSetting> = {};
  show.stageBoxes.forEach((b, i) => {
    boxes[b.id] = { danteStart: next, ioUnit: i + 1, danteOutStart: nextOut };
    next += b.inputs;
    nextOut += b.outputs;
  });
  return {
    items: { name: true, color: true, icon: true, patch: true, phantom: true, pair: true, dca: true, mute: true, outPatch: true, busNames: true },
    boxes,
    clearUnusedOutputs: false,
  };
}

/* ───────────── 계획 ───────────── */

export interface Dm7Change {
  item: Dm7Item;
  /** 인풋 채널 번호 (아웃풋 포트 변경이면 0) */
  ch: number;
  /** 표시용 대상 (없으면 "Ch n") */
  target?: string;
  field: string;
  before: string;
  after: string;
}

export interface Dm7Plan {
  changes: Dm7Change[];
  /** 내보내기 설정·데이터 문제 (점검 화면의 경고) */
  warnings: string[];
  /** 알림: 콘솔에서 따로 할 일 (경고 아님) */
  notes: string[];
  /** 항목별로 OnePatch 값을 넣은 수(total)와 그중 파일과 달라 바꾼 수(changed) */
  stats: Record<Dm7Item, { total: number; changed: number }>;
  profile: ConsoleProfile;
  /** 바뀐 Current 데이터 (적용할 때 쓴다) */
  current: Uint8Array;
  maxChannels: number;
  /** OnePatch 버스 → DM7 버스 대응 (아웃풋 패치를 켰을 때) */
  busMap: { bus: string; dm7: string }[];
}

const OMNI_BASE = 0x01401000;
const DANTE_BASE = 0x01a00000;
/* 아웃풋 패치 소스 (샘플 outpatch, outpatch2로 확인) */
const MIX_BASE = 0x03e00000;
const MATRIX_BASE = 0x04000000;
const STEREO_A = 0x04200000; // L, R = +0, +1
const STEREO_B = 0x04200010; // L (샘플 outpatch3). R은 미확인

export function sourceLabel(v: number): string {
  if (v === 0) return "없음";
  if (v >= MIX_BASE && v < MIX_BASE + 0x100) return `Mix ${v - MIX_BASE + 1}`;
  if (v >= MATRIX_BASE && v < MATRIX_BASE + 0x100) return `Matrix ${v - MATRIX_BASE + 1}`;
  if (v === STEREO_A || v === STEREO_A + 1) return `Stereo A ${v === STEREO_A ? "L" : "R"}`;
  if (v === STEREO_B) return "Stereo B";
  if (v >= OMNI_BASE && v < OMNI_BASE + 0x100) return `OMNI ${v - OMNI_BASE + 1}`;
  if (v >= DANTE_BASE && v < DANTE_BASE + 0x1000) return `Dante ${v - DANTE_BASE + 1}`;
  return `0x${v.toString(16)}`;
}

type PortTarget = { source: number; label: string; phantom: { kind: "omni"; port: number } | { kind: "dante"; unit: number; port: number } | null };

function portTarget(show: Show, port: PortRef | null, opts: Dm7Options): PortTarget | null | "unmapped" {
  if (!port || port.kind === "other") return null;
  if (port.kind === "local") {
    if (port.port > DM7_OMNI_COUNT) return "unmapped";
    return { source: OMNI_BASE + port.port - 1, label: `OMNI ${port.port}`, phantom: { kind: "omni", port: port.port } };
  }
  const s = opts.boxes[port.stageBoxId];
  if (!s?.danteStart) return "unmapped";
  const n = s.danteStart + port.port - 1;
  return {
    source: DANTE_BASE + n - 1,
    label: `Dante ${n}`,
    phantom: s.ioUnit ? { kind: "dante", unit: s.ioUnit, port: port.port } : null,
  };
}

const bits = (b: Uint8Array, f: ReturnType<typeof locate>, n: number) =>
  Array.from({ length: n }, (_, i) => readBit(b, f, i));
const listOn = (v: boolean[]) => v.map((on, i) => (on ? i + 1 : 0)).filter(Boolean).join(", ") || "—";

/**
 * 원본 파일과 Show로 바꿀 내용을 계산한다 (파일은 아직 만들지 않음).
 * OnePatch의 채널 번호 n → DM7 인풋 n. Show에 없는 채널은 건드리지 않는다.
 */
export function planDm7(show: Show, file: Dm7File, opts: Dm7Options, ctx: Dm7Context = {}): Dm7Plan {
  const block = findBlock(file, "CurrentBackupFile.bup");
  if (!block) throw new Error("파일에서 현재 설정(CurrentBackupFile.bup)을 찾지 못했습니다.");
  const cur = blockData(block).slice();
  const secs = parseSections(cur);
  const mixing = section(secs, "Mixing");
  const processing = section(secs, "Processing");
  const P = profileByModel(file.model);
  const maxChannels = Math.min(P.inputs, locate(mixing, ["InputChannel"]).node.count);
  const changes: Dm7Change[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const once = (list: string[]) => (w: string) => {
    if (!list.includes(w)) list.push(w);
  };
  const warn = once(warnings);
  const note = once(notes);
  const stats = Object.fromEntries(DM7_ITEMS.map((i) => [i.key, { total: 0, changed: 0 }])) as Dm7Plan["stats"];
  /** 항목 하나를 OnePatch 값으로 맞춤 (같으면 쓰지 않고 수만 센다) */
  const record = (c: Dm7Change, write?: () => void) => {
    stats[c.item].total++;
    if (c.before === c.after) return;
    write?.();
    stats[c.item].changed++;
    changes.push(c);
  };
  const I = opts.items;
  const chField = (n: number, ...path: string[]) => locate(mixing, [["InputChannel", n - 1], ...path]);

  const inRange = show.inputs.filter((c) => c.number >= 1 && c.number <= maxChannels);
  const out = show.inputs.filter((c) => !inRange.includes(c));
  if (out.length) note(`${P.name}의 인풋은 ${maxChannels}채널까지라 Ch ${out.map((c) => c.number).join(", ")}은(는) 넣지 않았습니다.`);
  const byNumber = new Map(inRange.map((c) => [c.number, c]));

  // 스테레오 페어: L 채널(stereoLinkNext)과 바로 다음 번호
  const pairL = new Set(inRange.filter((c) => c.stereoLinkNext && byNumber.has(c.number + 1)).map((c) => c.number));
  const pairR = new Set([...pairL].map((n) => n + 1));

  const phantomPorts = new Map<string, { on: boolean; chs: number[]; ref: ReturnType<typeof locate>; label: string }>();

  for (const ch of inRange) {
    const n = ch.number;
    const set = (item: Dm7Item, field: string, before: string, after: string, write: () => void) =>
      record({ item, ch: n, field, before, after }, write);

    if (I.name) {
      const name = fitName(ch.shortName || ch.source, P.nameMax) ?? "";
      if (/[^\x20-\x7e]/.test(name)) note("영문이 아닌 이름이 있습니다. 콘솔 SETUP의 Name Language를 그 언어(한국어)로 맞추세요.");
      const f = chField(n, "Label", "Name");
      set("name", "이름", readString(cur, f), name, () => writeString(cur, f, name));
    }
    if (I.color) {
      const c = consoleColor(P, ch.color, opts.colorMap);
      if (c) {
        const f = chField(n, "Label", "Color");
        set("color", "컬러", readString(cur, f), c.value, () => writeString(cur, f, c.value));
      }
    }
    if (I.icon) {
      const icon = pickIcon(P, show, ch, ctx.sources);
      const f = chField(n, "Label", "Icon");
      set("icon", "아이콘", readString(cur, f), icon, () => writeString(cur, f, icon));
    }
    const target = portTarget(show, ch.port, opts);
    if (target === "unmapped") warn(`Ch ${n}: 스테이지박스의 Dante 시작 번호가 비어 있거나 OMNI 범위를 넘어 패치하지 않았습니다.`);
    if (I.patch && target && target !== "unmapped") {
      const sel = chField(n, "InPatch", "Select");
      const src = locate(mixing, [["InputChannel", n - 1], "InPatch", ["Bank", 0], "Source"]);
      if (readBit(cur, sel)) {
        writeBit(cur, sel, 0, false);
        changes.push({ item: "patch", ch: n, field: "패치 뱅크", before: "B", after: "A" });
      }
      set("patch", "패치", sourceLabel(readUint(cur, src)), target.label, () => writeUint(cur, src, target.source));
    }
    if (I.phantom && target && target !== "unmapped") {
      if (!target.phantom) warn("48V: I/O 유닛 번호가 비어 있는 스테이지박스의 48V는 쓰지 않았습니다.");
      else {
        const p = target.phantom;
        const ref =
          p.kind === "omni"
            ? locate(processing, ["Omni", ["InputPort", p.port - 1], "HeadAmp", "48V"])
            : locate(mixing, ["DanteRemoteControl", ["IOUnit", p.unit - 1], ["InputPort", p.port - 1], "HeadAmp", "48V"]);
        const key = `${p.kind}:${p.kind === "dante" ? p.unit : 0}:${p.port}`;
        const on = resolvePhantom(show, ch);
        const prev = phantomPorts.get(key);
        if (prev && prev.on !== on) warn(`${target.label}: 같은 포트를 쓰는 채널의 48V가 서로 달라 켜짐으로 했습니다.`);
        phantomPorts.set(key, {
          on: (prev?.on ?? false) || on,
          chs: [...(prev?.chs ?? []), n],
          ref,
          label: p.kind === "omni" ? `OMNI ${p.port}` : `I/O 유닛 ${p.unit} 포트 ${p.port}`,
        });
      }
    }
    if (I.pair) {
      const gang = [chField(n, "GainGang"), chField(n, "DelayGang")];
      const rel = chField(n, "Signal", "Relation");
      const pan = chField(n, "ToStereo", "PanType");
      const want = pairL.has(n) ? 0x80 : pairR.has(n) ? 0x01 : 0x00;
      const before = readUint(cur, rel);
      const label = (v: number) => (v === 0x80 ? `페어 L (${n}–${n + 1})` : v === 0x01 ? `페어 R (${n - 1}–${n})` : v ? `0x${v.toString(16)}` : "단독");
      if (want || before) {
        set("pair", "페어", label(before), label(want), () => {
          writeUint(cur, rel, want);
          for (const g of gang) writeBit(cur, g, 0, want !== 0);
          writeString(cur, pan, want ? "BALANCE" : "PAN");
        });
      }
      if (want === 0x80 && n % 2 === 0) warn(`Ch ${n}–${n + 1} 페어가 짝수 채널에서 시작합니다.`);
    }
    // 페어 R 채널은 L의 DCA·뮤트도 따라간다 (DM7은 페어끼리 묶어서 저장)
    const groupSrc = pairR.has(n) ? [ch, byNumber.get(n - 1)!] : pairL.has(n) ? [ch, byNumber.get(n + 1)!] : [ch];
    if (I.dca) {
      const nums = new Set(groupSrc.flatMap((c) => c.dcaIds).map((id) => show.dcas.find((d) => d.id === id)?.number ?? 0));
      const f = chField(n, "DCA", "Assign");
      const before = bits(cur, f, Math.min(P.dcas, f.node.count));
      const after = before.map((_, i) => nums.has(i + 1));
      if (nums.size || before.some(Boolean)) set("dca", "DCA", listOn(before), listOn(after), () => after.forEach((on, i) => writeBit(cur, f, i, on)));
    }
    if (I.mute) {
      const nums = new Set(groupSrc.flatMap((c) => c.muteGroupIds).map((id) => show.muteGroups.find((g) => g.id === id)?.number ?? 0));
      const f = chField(n, "MuteGroup", "Assign");
      const before = bits(cur, f, Math.min(P.muteGroups, f.node.count));
      const after = before.map((_, i) => nums.has(i + 1));
      if (nums.size || before.some(Boolean)) set("mute", "뮤트", listOn(before), listOn(after), () => after.forEach((on, i) => writeBit(cur, f, i, on)));
    }
  }

  for (const p of phantomPorts.values()) {
    const before = readBit(cur, p.ref);
    record({ item: "phantom", ch: p.chs[0], field: `48V (${p.label})`, before: before ? "켜짐" : "꺼짐", after: p.on ? "켜짐" : "꺼짐" }, () => writeBit(cur, p.ref, 0, p.on));
  }
  const ctxOut: OutCtx = { show, cur, P, record, warn, note };
  const busMap = I.outPatch ? planOutputs(ctxOut, processing, opts) : [];
  if (I.busNames) planNames(ctxOut, mixing);
  return { changes, warnings, notes, stats, profile: P, current: cur, maxChannels, busMap };
}

/* ───────────── 버스·DCA·뮤트 그룹 이름 ───────────── */

type OutCtx = {
  show: Show;
  cur: Uint8Array;
  P: ConsoleProfile;
  record: (c: Dm7Change, write?: () => void) => void;
  warn: (w: string) => void;
  note: (w: string) => void;
};

/**
 * 이름을 콘솔 글자 수로 맞추기 (빈 이름이면 null = 파일의 기본 이름을 그대로 둠).
 * 넘는 이름은 내보내기 전 점검 화면(src/export/checks.ts)에서 고치게 하고, 그대로 내보내면 뒤를 자른다.
 */
function fitName(raw: string, max: number): string | null {
  const t = raw.trim();
  if (!t) return null;
  return [...t].slice(0, max).join("").trimEnd();
}

/**
 * Mix·Matrix·Stereo·DCA·뮤트 그룹 이름 (샘플 busname으로 확인: 각 Label/Name).
 * Mix·Matrix 번호는 아웃풋 패치와 같은 배정(allocateBuses)을 따른다.
 * Stereo 컬렉션은 4개(A L, A R, B L, B R)라 Main 이름을 둘씩 쓴다.
 */
function planNames({ show, cur, P, record, warn, note }: OutCtx, mixing: MbdfSection) {
  const write = (coll: string, index: number, target: string, name: string) => {
    const f = locate(mixing, [[coll, index], "Label", "Name"]);
    record({ item: "busNames", ch: 0, target, field: "이름", before: readString(cur, f), after: name }, () => writeString(cur, f, name));
  };
  for (const a of allocateBuses(show, { warn, note }, P)) {
    const name = fitName(a.bus.name, P.nameMax);
    if (!name) continue;
    if (a.bus.kind === "main") {
      const first = a.label === "Stereo A" ? 0 : 2;
      [first, first + 1].forEach((i, k) => write("Stereo", i, `${a.label} ${k ? "R" : "L"}`, name));
      continue;
    }
    const coll = a.bus.kind === "aux" ? "Mix" : "Matrix";
    const base = a.bus.kind === "aux" ? MIX_BASE : MATRIX_BASE;
    for (const src of a.sources) write(coll, src - base, `${coll} ${src - base + 1}`, name);
  }
  for (const d of show.dcas) {
    if (d.number > P.dcas) continue;
    const name = fitName(d.name, P.nameMax);
    if (name) write("DCA", d.number - 1, `DCA ${d.number}`, name);
  }
  for (const g of show.muteGroups) {
    if (g.number > P.muteGroups) continue;
    const name = fitName(g.name, P.nameMax);
    if (name) write("Mute", g.number - 1, `뮤트 그룹 ${g.number}`, name);
  }
}

/* ───────────── 아웃풋 패치 ───────────── */

/**
 * OnePatch 버스 → DM7 버스 소스 번호.
 * Aux는 표의 행 순서대로 DM7 Mix 번호를 받는다. 스테레오 버스는 홀수에서 시작하는 Mix 두 개(L/R).
 * Matrix도 같은 방식. Main은 첫째 → Stereo A(L/R), 둘째(Mono/Sub 등) → Stereo B.
 * Stereo B의 R 소스 번호는 미확인이라 스테레오인 경우 L만 쓴다.
 */
export function allocateBuses(
  show: Show,
  log: { warn: (w: string) => void; note: (w: string) => void } | ((w: string) => void),
  P: ConsoleProfile = DEFAULT_CONSOLE_PROFILE,
) {
  const { warn, note } = typeof log === "function" ? { warn: log, note: log } : log;
  const out: { bus: OutputBus; label: string; sources: number[] }[] = [];
  const alloc = (kind: BusKind, base: number, max: number, name: string) => {
    let next = 1;
    for (const b of busesOf(show, kind)) {
      if (b.width === "stereo" && next % 2 === 0) next++;
      const n = b.width === "stereo" ? 2 : 1;
      if (next + n - 1 > max) {
        note(`${name} 수가 ${P.name}의 ${max}개를 넘어 “${b.name || `${name} ${b.number}`}”부터는 넣지 않았습니다.`);
        return;
      }
      const sources = Array.from({ length: n }, (_, k) => base + next - 1 + k);
      out.push({ bus: b, label: n === 2 ? `${name} ${next}/${next + 1}` : `${name} ${next}`, sources });
      next += n;
    }
  };
  alloc("aux", MIX_BASE, P.mixes, "Mix");
  alloc("matrix", MATRIX_BASE, P.matrices, "Matrix");
  busesOf(show, "main").forEach((b, i) => {
    if (i === 0) out.push({ bus: b, label: "Stereo A", sources: b.width === "stereo" ? [STEREO_A, STEREO_A + 1] : [STEREO_A] });
    else if (i === 1) {
      out.push({ bus: b, label: "Stereo B", sources: [STEREO_B] });
      if (b.width === "stereo" && b.ports.length > 1)
        warn(`“${b.name || "Main"}”: Stereo B의 R 출력 소스 번호는 아직 확인하지 못해 L만 패치했습니다.`);
    } else if (b.ports.length) note(`“${b.name || "Main"}”: ${P.name}의 Stereo는 A·B 두 개라 패치하지 않았습니다.`);
  });
  if (out.some((x) => x.sources.length === 2 && x.bus.kind !== "main"))
    note("스테레오 Mix·Matrix는 콘솔(또는 DM Editor)의 Bus Setup에서 해당 번호 두 개를 스테레오로 설정하세요. OnePatch는 출력 패치와 이름만 씁니다.");
  return out;
}

function planOutputs({ show, cur, P, record, warn, note }: OutCtx, processing: MbdfSection, opts: Dm7Options) {
  const alloc = allocateBuses(show, { warn, note }, P);
  const omniCount = locate(processing, ["Omni", "OutputPort"]).node.count;
  const danteCount = locate(processing, ["Dante", "OutputPort"]).node.count;
  const portRef = (p: PortRef): { sec: "Omni" | "Dante"; index: number; label: string } | null => {
    if (p.kind === "local") return p.port <= omniCount ? { sec: "Omni", index: p.port - 1, label: `OMNI OUT ${p.port}` } : null;
    if (p.kind === "stagebox") {
      const start = opts.boxes[p.stageBoxId]?.danteOutStart;
      if (!start) return null;
      const n = start + p.port - 1;
      return n <= danteCount ? { sec: "Dante", index: n - 1, label: `Dante OUT ${n}` } : null;
    }
    return null;
  };
  const written = new Map<string, { source: number; bus: string; label: string; sec: "Omni" | "Dante"; index: number }>();
  for (const a of alloc) {
    a.bus.ports.forEach((p, side) => {
      const r = portRef(p);
      if (!r) {
        if (p.kind !== "other") warn(`“${a.bus.name}”의 출력 일부: 박스의 Dante OUT 시작 번호가 비어 있거나 범위를 넘어 패치하지 않았습니다.`);
        return;
      }
      if (a.label === "Stereo B" && side > 0) return; // R 소스 번호 미확인
      const source = a.sources[Math.min(side, a.sources.length - 1)];
      const key = `${r.sec}:${r.index}`;
      const prev = written.get(key);
      if (prev) {
        warn(`${r.label}: “${prev.bus}”와 “${a.bus.name}”가 같은 출력을 씁니다. 앞의 것을 남겼습니다.`);
        return;
      }
      written.set(key, { source, bus: a.bus.name, ...r });
    });
  }
  const setPort = (sec: "Omni" | "Dante", index: number, label: string, source: number) => {
    const f = locate(processing, [sec, ["OutputPort", index], "Patch", "Source"]);
    const before = readUint(cur, f);
    record({ item: "outPatch", ch: 0, target: label, field: "출력 소스", before: sourceLabel(before), after: sourceLabel(source) }, () => writeUint(cur, f, source));
  };
  for (const w of written.values()) setPort(w.sec, w.index, w.label, w.source);
  if (opts.clearUnusedOutputs) {
    const managed: { sec: "Omni" | "Dante"; index: number; label: string }[] = [];
    for (let i = 0; i < omniCount; i++) managed.push({ sec: "Omni", index: i, label: `OMNI OUT ${i + 1}` });
    for (const b of show.stageBoxes) {
      const start = opts.boxes[b.id]?.danteOutStart;
      if (!start) continue;
      for (let p = 0; p < b.outputs && start + p <= danteCount; p++)
        managed.push({ sec: "Dante", index: start + p - 1, label: `Dante OUT ${start + p}` });
    }
    for (const m of managed) if (!written.has(`${m.sec}:${m.index}`)) setPort(m.sec, m.index, m.label, 0);
  }
  return alloc.map((a) => ({ bus: a.bus.name || `${a.bus.kind} ${a.bus.number}`, dm7: a.label }));
}

/** 계획을 파일에 반영 (현재 설정과 그 백업 사본을 함께 바꾼다) */
export function applyDm7(file: Dm7File, plan: Dm7Plan): Dm7File {
  return {
    ...file,
    blocks: file.blocks.map((b) =>
      b.category === "Current" && (b.name === "CurrentBackupFile.bup" || b.name === "CurrentBackupFile.bup.old")
        ? { ...b, replaced: plan.current }
        : b,
    ),
  };
}

export type { MbdfSection };
