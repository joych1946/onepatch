/**
 * 버스 누르기 입력용 이름 목록 (용도별). 고르면 이름·용도·모노/스테레오·프리/포스트가 함께 들어간다.
 * 기종 중립: 콘솔의 버스 수나 이름 길이 제한은 여기서 다루지 않는다.
 */
import { busesOf, updateBus } from "./outputOps";
import type { BusKind, BusPurpose, OutputBus, Show } from "./schema";
import { norm } from "./text";

export interface BusPreset {
  id: string;
  group: string;
  name: string;
  /** 고를 때마다 번호: Wedge 1, Wedge 2… */
  numbered?: boolean;
  purpose: BusPurpose;
  width: OutputBus["width"];
  tap?: OutputBus["tap"];
}

type P = [id: string, name: string, purpose: BusPurpose, width: OutputBus["width"], opt?: { numbered?: boolean; tap?: OutputBus["tap"] }];

const g = (group: string, list: P[]): BusPreset[] =>
  list.map(([id, name, purpose, width, opt]) => ({ id, group, name, purpose, width, ...opt }));

const AUX: BusPreset[] = [
  ...g("모니터", [
    ["wedge", "Wedge", "wedge", "mono", { numbered: true, tap: "pre" }],
    ["drum-fill", "Drum Fill", "wedge", "mono", { tap: "pre" }],
    ["side-fill", "Side Fill", "sidefill", "stereo", { tap: "pre" }],
  ]),
  ...g("IEM", [
    ["iem", "IEM", "iem", "stereo", { numbered: true, tap: "pre" }],
    ["iem-mono", "IEM Mono", "iem", "mono", { numbered: true, tap: "pre" }],
  ]),
  ...g("FX 센드", [
    ["reverb", "Reverb", "fx", "mono", { numbered: true, tap: "post" }],
    ["delay", "Delay", "fx", "mono", { numbered: true, tap: "post" }],
    ["plate", "Plate", "fx", "mono", { tap: "post" }],
    ["hall", "Hall", "fx", "mono", { tap: "post" }],
    ["room", "Room", "fx", "mono", { tap: "post" }],
    ["vox-rev", "Vox Rev", "fx", "mono", { tap: "post" }],
    ["drum-rev", "Drum Rev", "fx", "mono", { tap: "post" }],
    ["chorus", "Chorus", "fx", "mono", { tap: "post" }],
  ]),
  ...g("기타", [
    ["aux-rec", "Rec", "record", "stereo", { tap: "post" }],
    ["aux-bcast", "Broadcast", "broadcast", "stereo", { tap: "post" }],
  ]),
];

const MATRIX: BusPreset[] = g("Matrix", [
  ["front-fill", "Front Fill", "frontfill", "mono"],
  ["delay-spk", "Delay Spk", "delay", "stereo"],
  ["under-balc", "Under Balcony", "delay", "mono"],
  ["out-fill", "Out Fill", "frontfill", "stereo"],
  ["lobby", "Lobby", "lobby", "mono"],
  ["mtx-rec", "Rec", "record", "stereo"],
  ["mtx-bcast", "Broadcast", "broadcast", "stereo"],
]);

const MAIN: BusPreset[] = g("Main", [
  ["main-lr", "Main L/R", "pa", "stereo"],
  ["mono", "Mono", "pa", "mono"],
  ["sub", "Sub", "sub", "mono"],
  ["mono-sub", "Mono/Sub", "sub", "mono"],
]);

export const BUS_PRESETS: Record<BusKind, BusPreset[]> = { aux: AUX, matrix: MATRIX, main: MAIN };

/** 버스 이름 → 프리셋 (번호 붙은 이름 "Wedge 3"도) */
export function findPreset(kind: BusKind, name: string): { preset: BusPreset; num?: number } | null {
  const n = norm(name);
  if (!n) return null;
  for (const p of BUS_PRESETS[kind]) if (norm(p.name) === n) return { preset: p };
  const m = name.trim().match(/^(.*\S)\s*(\d+)$/);
  if (m) {
    for (const p of BUS_PRESETS[kind])
      if (p.numbered && norm(p.name) === norm(m[1])) return { preset: p, num: parseInt(m[2], 10) };
  }
  return null;
}

export function presetName(show: Show, kind: BusKind, p: BusPreset, exceptIndex = -1): string {
  if (!p.numbered) return p.name;
  let max = 0;
  busesOf(show, kind).forEach((b, i) => {
    if (i === exceptIndex) return;
    const f = findPreset(kind, b.name);
    if (f?.preset.id === p.id) max = Math.max(max, f.num ?? 1);
  });
  return `${p.name} ${max + 1}`;
}

/** 직전 버스와 같은(번호) 프리셋을 먼저, 그 다음 목록 순서에서 직전 것 뒤의 안 쓴 것 */
export function suggestNextPresets(show: Show, kind: BusKind, index: number, limit = 3): BusPreset[] {
  const list = BUS_PRESETS[kind];
  const buses = busesOf(show, kind);
  const used = new Set(
    buses.flatMap((b, i) => {
      const f = i === index ? null : findPreset(kind, b.name);
      return f && !f.preset.numbered ? [f.preset.id] : [];
    }),
  );
  let from = 0;
  const out: BusPreset[] = [];
  for (let i = Math.min(index, buses.length) - 1; i >= 0; i--) {
    const f = findPreset(kind, buses[i].name);
    if (f) {
      from = list.indexOf(f.preset) + 1;
      if (f.preset.numbered) out.push(f.preset);
      break;
    }
  }
  for (const p of list.slice(from)) {
    if (out.length >= limit) break;
    if (!used.has(p.id) && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * 프리셋 적용: 이름·용도·모노/스테레오·프리/포스트. 포트와 비고는 그대로.
 * Matrix는 소스가 비어 있으면 Main L/R(첫 메인)에서 받는 것으로 채운다.
 */
export function applyPreset(show: Show, kind: BusKind, index: number, p: BusPreset | { name: string }): Show {
  if (!("id" in p)) return updateBus(show, kind, index, { name: p.name.trim() });
  const bus = busesOf(show, kind)[index];
  const patch: Partial<OutputBus> = {
    name: presetName(show, kind, p, index),
    purpose: p.purpose,
    width: p.width,
  };
  // 같은 번호 프리셋을 다시 고르면 번호 유지
  const cur = findPreset(kind, bus.name);
  if (cur?.preset.id === p.id) patch.name = bus.name;
  if (p.tap) patch.tap = p.tap;
  if (kind === "matrix" && bus.sources.length === 0) {
    const main = busesOf(show, "main")[0];
    if (main) patch.sources = [main.id];
  }
  return updateBus(show, kind, index, patch);
}
