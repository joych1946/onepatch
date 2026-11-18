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
import { busesOf } from "@/model/outputOps";
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

export const DM7_NAME_MAX = 8;
export const DM7_DCA_COUNT = 24;
export const DM7_MUTE_COUNT = 12;
export const DM7_OMNI_COUNT = 32; // 스키마의 Omni 인풋 포트 수 (DM7 Compact 본체 입력은 이보다 적을 수 있음)

/** 파일(Editor)이 쓰는 컬러 이름. OSC 규격의 목록과 다르다(docs/research/dm7.md 3절) */
export const DM7_COLOR: Record<Exclude<Color, "none">, { value: string; approx?: boolean }> = {
  red: { value: "Red" },
  orange: { value: "Orange" },
  yellow: { value: "Yellow" },
  green: { value: "Green" },
  cyan: { value: "SkyBlue" },
  blue: { value: "Blue" },
  purple: { value: "Purple" },
  white: { value: "White" },
  pink: { value: "Pink" },
  lime: { value: "LtGreen" },
  brown: { value: "Orange", approx: true },
  gray: { value: "White", approx: true },
};

/** 실제 DM7 파일에서 본 아이콘 이름만 쓴다 (규격 미공개) */
const ICON_RULES: [RegExp, string][] = [
  [/kick|킥|bd\b|bass ?drum/i, "Kick"],
  [/snare|스네어|\bsn\b/i, "Snare"],
  [/hi-?hat|하이햇|\bhh\b/i, "Hi-Hat"],
  [/floor|f\.?tom|플로어/i, "F.Tom"],
  [/tom|탐/i, "Tom"],
  [/\boh\b|overhead|오버헤드|cymbal|ride|crash|심벌/i, "Cymbal"],
  [/contra|upright|콘트라/i, "A.Bass"],
  [/bass ?(amp|mic|cab)|베이스 ?(앰프|마이크)/i, "BassAmp"],
  [/bass|베이스/i, "E.Bass"],
  [/a\.? ?g(ui)?tr|acoustic|어쿠스틱|통기타/i, "A.Guitar"],
  [/g(ui)?tr.*(amp|mic|cab)|guitar ?amp|기타 ?앰프/i, "GuitarAmp"],
  [/g(ui)?tr|guitar|기타/i, "E.Guitar"],
  [/piano|피아노/i, "Piano"],
  [/key|synth|organ|건반|신스/i, "Keyboard"],
  [/violin|viola|cello|string|바이올린|첼로|현악|가야금|거문고|해금|아쟁/i, "Strings"],
  [/\bmr\b|track|playback|click|mtr|laptop|\bpc\b|반주/i, "Media1"],
  [/talk ?back|\btb\b|토크백|podium|연설/i, "Podium"],
];

function iconFor(show: Show, ch: Show["inputs"][number]): string | null {
  const text = `${ch.source} ${ch.shortName}`;
  const mic = ch.mic?.kind === "library" ? show.microphones.find((m) => m.id === (ch.mic as { microphoneId: string }).microphoneId) : undefined;
  for (const [re, icon] of ICON_RULES) if (re.test(text)) return icon;
  if (/vox|vocal|voice|chorus|mc|보컬|사회|코러스|소리|민요/i.test(text)) return mic?.type === "wireless" ? "Wireless" : "Dynamic";
  return null;
}

/* ───────────── 설정 ───────────── */

export type Dm7Item = "name" | "color" | "icon" | "patch" | "phantom" | "pair" | "dca" | "mute" | "outPatch" | "busNames";
export const DM7_ITEMS: { key: Dm7Item; label: string; note?: string }[] = [
  { key: "name", label: "이름", note: "짧은 이름(없으면 소스명), 8자" },
  { key: "color", label: "컬러" },
  { key: "icon", label: "아이콘", note: "소스명으로 추정 · 확인 필요" },
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
    items: { name: true, color: true, icon: false, patch: true, phantom: true, pair: true, dca: true, mute: true, outPatch: true, busNames: true },
    boxes,
    clearUnusedOutputs: false,
  };
}

/* ───────────── 계획 ───────────── */

export interface Dm7Change {
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
  warnings: string[];
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
export const DM7_MIX_COUNT = 48;
export const DM7_MATRIX_COUNT = 12;

export function sourceLabel(v: number): string {
  if (v === 0) return "없음";
  if (v >= MIX_BASE && v < MIX_BASE + DM7_MIX_COUNT) return `Mix ${v - MIX_BASE + 1}`;
  if (v >= MATRIX_BASE && v < MATRIX_BASE + DM7_MATRIX_COUNT) return `Matrix ${v - MATRIX_BASE + 1}`;
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
export function planDm7(show: Show, file: Dm7File, opts: Dm7Options): Dm7Plan {
  const block = findBlock(file, "CurrentBackupFile.bup");
  if (!block) throw new Error("파일에서 현재 설정(CurrentBackupFile.bup)을 찾지 못했습니다.");
  const cur = blockData(block).slice();
  const secs = parseSections(cur);
  const mixing = section(secs, "Mixing");
  const processing = section(secs, "Processing");
  const maxChannels = Math.min(file.model === "DM7C" ? 72 : 120, locate(mixing, ["InputChannel"]).node.count);
  const changes: Dm7Change[] = [];
  const warnings: string[] = [];
  const warnOnce = new Set<string>();
  const warn = (w: string) => {
    if (!warnOnce.has(w)) {
      warnOnce.add(w);
      warnings.push(w);
    }
  };
  const I = opts.items;
  const chField = (n: number, ...path: string[]) => locate(mixing, [["InputChannel", n - 1], ...path]);

  const inRange = show.inputs.filter((c) => c.number >= 1 && c.number <= maxChannels);
  const out = show.inputs.filter((c) => !inRange.includes(c));
  if (out.length) warn(`${file.model}의 인풋은 ${maxChannels}채널까지입니다. Ch ${out.map((c) => c.number).join(", ")}은(는) 넣지 않았습니다.`);
  const byNumber = new Map(inRange.map((c) => [c.number, c]));

  // 스테레오 페어: L 채널(stereoLinkNext)과 바로 다음 번호
  const pairL = new Set(inRange.filter((c) => c.stereoLinkNext && byNumber.has(c.number + 1)).map((c) => c.number));
  const pairR = new Set([...pairL].map((n) => n + 1));

  const phantomPorts = new Map<string, { on: boolean; chs: number[]; ref: ReturnType<typeof locate>; label: string }>();

  for (const ch of inRange) {
    const n = ch.number;
    const set = (field: string, before: string, after: string, write: () => void) => {
      if (before === after) return;
      write();
      changes.push({ ch: n, field, before, after });
    };

    if (I.name) {
      const raw = (ch.shortName || ch.source).trim();
      const chars = [...raw];
      const name = chars.slice(0, DM7_NAME_MAX).join("");
      if (chars.length > DM7_NAME_MAX) warn(`Ch ${n} 이름 “${raw}”을(를) 8자 “${name}”로 잘랐습니다.`);
      if (/[^\x20-\x7e]/.test(name)) warn("영문이 아닌 이름이 있습니다. 콘솔 SETUP의 Name Language가 그 언어로 되어 있어야 제대로 보입니다.");
      const f = chField(n, "Label", "Name");
      set("이름", readString(cur, f), name, () => writeString(cur, f, name));
    }
    if (I.color && ch.color !== "none") {
      const c = DM7_COLOR[ch.color];
      if (c.approx) warn(`DM7에 없는 컬러는 가까운 색으로 바꿨습니다 (갈색 → Orange, 회색 → White).`);
      const f = chField(n, "Label", "Color");
      set("컬러", readString(cur, f), c.value, () => writeString(cur, f, c.value));
    }
    if (I.icon) {
      const icon = iconFor(show, ch);
      if (icon) {
        const f = chField(n, "Label", "Icon");
        set("아이콘", readString(cur, f), icon, () => writeString(cur, f, icon));
      }
    }
    const target = portTarget(show, ch.port, opts);
    if (target === "unmapped") warn(`Ch ${n}: 스테이지박스의 Dante 시작 번호가 비어 있거나 OMNI 범위를 넘어 패치하지 않았습니다.`);
    if (I.patch && target && target !== "unmapped") {
      const sel = chField(n, "InPatch", "Select");
      const src = locate(mixing, [["InputChannel", n - 1], "InPatch", ["Bank", 0], "Source"]);
      if (readBit(cur, sel)) {
        writeBit(cur, sel, 0, false);
        changes.push({ ch: n, field: "패치 뱅크", before: "B", after: "A" });
      }
      set("패치", sourceLabel(readUint(cur, src)), target.label, () => writeUint(cur, src, target.source));
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
      if (before !== want) {
        writeUint(cur, rel, want);
        for (const g of gang) writeBit(cur, g, 0, want !== 0);
        writeString(cur, pan, want ? "BALANCE" : "PAN");
        changes.push({ ch: n, field: "페어", before: label(before), after: label(want) });
      }
      if (want === 0x80 && n % 2 === 0) warn(`Ch ${n}–${n + 1} 페어가 짝수 채널에서 시작합니다.`);
    }
    // 페어 R 채널은 L의 DCA·뮤트도 따라간다 (DM7은 페어끼리 묶어서 저장)
    const groupSrc = pairR.has(n) ? [ch, byNumber.get(n - 1)!] : pairL.has(n) ? [ch, byNumber.get(n + 1)!] : [ch];
    if (I.dca) {
      const nums = new Set(groupSrc.flatMap((c) => c.dcaIds).map((id) => show.dcas.find((d) => d.id === id)?.number ?? 0));
      [...nums].filter((x) => x > DM7_DCA_COUNT).forEach((x) => warn(`DCA ${x}: DM7은 DCA ${DM7_DCA_COUNT}까지라 넣지 않았습니다.`));
      const f = chField(n, "DCA", "Assign");
      const before = bits(cur, f, DM7_DCA_COUNT);
      const after = before.map((_, i) => nums.has(i + 1));
      set("DCA", listOn(before), listOn(after), () => after.forEach((on, i) => writeBit(cur, f, i, on)));
    }
    if (I.mute) {
      const nums = new Set(groupSrc.flatMap((c) => c.muteGroupIds).map((id) => show.muteGroups.find((g) => g.id === id)?.number ?? 0));
      [...nums].filter((x) => x > DM7_MUTE_COUNT).forEach((x) => warn(`뮤트 그룹 ${x}: DM7은 ${DM7_MUTE_COUNT}까지라 넣지 않았습니다.`));
      const f = chField(n, "MuteGroup", "Assign");
      const before = bits(cur, f, DM7_MUTE_COUNT);
      const after = before.map((_, i) => nums.has(i + 1));
      set("뮤트", listOn(before), listOn(after), () => after.forEach((on, i) => writeBit(cur, f, i, on)));
    }
  }

  for (const p of phantomPorts.values()) {
    const before = readBit(cur, p.ref);
    if (before !== p.on) {
      writeBit(cur, p.ref, 0, p.on);
      changes.push({ ch: p.chs[0], field: `48V (${p.label})`, before: before ? "켜짐" : "꺼짐", after: p.on ? "켜짐" : "꺼짐" });
    }
  }
  const busMap = I.outPatch ? planOutputs(show, cur, processing, opts, changes, warn) : [];
  if (I.busNames) planNames(show, cur, mixing, changes, warn);
  return { changes, warnings, current: cur, maxChannels, busMap };
}

/* ───────────── 버스·DCA·뮤트 그룹 이름 ───────────── */

/** 이름 8자로 맞추기 (빈 이름이면 null = 파일의 기본 이름을 그대로 둠) */
function fitName(raw: string, what: string, warn: (w: string) => void): string | null {
  const t = raw.trim();
  if (!t) return null;
  const chars = [...t];
  const name = chars.slice(0, DM7_NAME_MAX).join("").trimEnd();
  if (chars.length > DM7_NAME_MAX) warn(`${what} 이름 “${t}”을(를) 8자 “${name}”로 잘랐습니다.`);
  return name;
}

/**
 * Mix·Matrix·Stereo·DCA·뮤트 그룹 이름 (샘플 busname으로 확인: 각 Label/Name).
 * Mix·Matrix 번호는 아웃풋 패치와 같은 배정(allocateBuses)을 따른다.
 * Stereo 컬렉션은 4개(A L, A R, B L, B R)라 Main 이름을 둘씩 쓴다.
 */
function planNames(show: Show, cur: Uint8Array, mixing: MbdfSection, changes: Dm7Change[], warn: (w: string) => void) {
  const write = (coll: string, index: number, target: string, name: string) => {
    const f = locate(mixing, [[coll, index], "Label", "Name"]);
    const before = readString(cur, f);
    if (before === name) return;
    writeString(cur, f, name);
    changes.push({ ch: 0, target, field: "이름", before, after: name });
  };
  for (const a of allocateBuses(show, warn)) {
    const name = fitName(a.bus.name, a.label, warn);
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
    if (d.number > DM7_DCA_COUNT) continue;
    const name = fitName(d.name, `DCA ${d.number}`, warn);
    if (name) write("DCA", d.number - 1, `DCA ${d.number}`, name);
  }
  for (const g of show.muteGroups) {
    if (g.number > DM7_MUTE_COUNT) continue;
    const name = fitName(g.name, `뮤트 그룹 ${g.number}`, warn);
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
export function allocateBuses(show: Show, warn: (w: string) => void) {
  const out: { bus: OutputBus; label: string; sources: number[] }[] = [];
  const alloc = (kind: BusKind, base: number, max: number, name: string) => {
    let next = 1;
    for (const b of busesOf(show, kind)) {
      if (b.width === "stereo" && next % 2 === 0) next++;
      const n = b.width === "stereo" ? 2 : 1;
      if (next + n - 1 > max) {
        warn(`${name} 수가 DM7의 ${max}개를 넘어 “${b.name || `${name} ${b.number}`}”부터는 넣지 않았습니다.`);
        return;
      }
      const sources = Array.from({ length: n }, (_, k) => base + next - 1 + k);
      out.push({ bus: b, label: n === 2 ? `${name} ${next}/${next + 1}` : `${name} ${next}`, sources });
      next += n;
    }
  };
  alloc("aux", MIX_BASE, DM7_MIX_COUNT, "Mix");
  alloc("matrix", MATRIX_BASE, DM7_MATRIX_COUNT, "Matrix");
  busesOf(show, "main").forEach((b, i) => {
    if (i === 0) out.push({ bus: b, label: "Stereo A", sources: b.width === "stereo" ? [STEREO_A, STEREO_A + 1] : [STEREO_A] });
    else if (i === 1) {
      out.push({ bus: b, label: "Stereo B", sources: [STEREO_B] });
      if (b.width === "stereo" && b.ports.length > 1)
        warn(`“${b.name || "Main"}”: Stereo B의 R 출력 소스 번호는 아직 확인하지 못해 L만 패치했습니다.`);
    } else if (b.ports.length) warn(`“${b.name || "Main"}”: DM7의 Stereo는 A·B 두 개라 패치하지 않았습니다.`);
  });
  if (out.some((x) => x.sources.length === 2 && x.bus.kind !== "main"))
    warn("스테레오 Mix·Matrix는 DM7 DM Editor의 Bus Setup에서 해당 번호 두 개를 스테레오(페어)로 설정해야 합니다. OnePatch는 출력 패치만 씁니다.");
  return out;
}

function planOutputs(
  show: Show,
  cur: Uint8Array,
  processing: MbdfSection,
  opts: Dm7Options,
  changes: Dm7Change[],
  warn: (w: string) => void,
) {
  const alloc = allocateBuses(show, warn);
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
    if (before === source) return;
    writeUint(cur, f, source);
    changes.push({ ch: 0, target: label, field: "출력 소스", before: sourceLabel(before), after: sourceLabel(source) });
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
