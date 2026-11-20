/**
 * 크루 배포용 출력물의 내용 — 순수 함수. 화면(인쇄 미리보기), 엑셀, CSV가 같은 데이터를 쓴다.
 * 모양(쪽 나누기, 글자 크기)은 components/print가 맡는다.
 */
import { micName, resolvePhantom, resolveStand } from "./derive";
import { BUS_PURPOSE_LABEL, COLOR_LABEL, formatPort, MIC_TYPE_LABEL } from "./labels";
import type { Library } from "./library";
import { libMicOf } from "./library";
import { formatOutPorts, busShort } from "./outputColumns";
import { busesOf } from "./outputOps";
import type { BusKind, Color, MicType, OutputBus, Show } from "./schema";

/* ───────────── 표 공통 ───────────── */

export interface ReportColumn {
  key: string;
  label: string;
  /** 인쇄 폭 비율 (표 폭을 나눠 가짐) */
  width: number;
  align?: "left" | "center" | "right";
  /** 기본으로 보이는가 */
  default?: boolean;
}

export type Cell = string | number;
/** id: 채널·버스 id (버전 비교와 바뀐 행 표시에 쓴다) */
export type ReportRow = { cells: Record<string, Cell>; color?: Color; id?: string };

/* ───────────── 인풋리스트 ───────────── */

export const INPUT_REPORT_COLUMNS: ReportColumn[] = [
  { key: "ch", label: "Ch", width: 4, align: "center", default: true },
  { key: "source", label: "소스", width: 15, default: true },
  { key: "shortName", label: "짧은 이름", width: 9, default: true },
  { key: "performer", label: "연주자", width: 9 },
  { key: "mic", label: "마이크/DI", width: 15, default: true },
  { key: "stand", label: "스탠드", width: 8, default: true },
  { key: "phantom", label: "48V", width: 5, align: "center", default: true },
  { key: "port", label: "패치", width: 10, default: true },
  { key: "link", label: "링크", width: 5, align: "center", default: true },
  { key: "color", label: "컬러", width: 6, default: true },
  { key: "dca", label: "DCA", width: 8, default: true },
  { key: "mute", label: "뮤트", width: 7 },
  { key: "notes", label: "비고", width: 16, default: true },
];

export function inputReportRows(show: Show): ReportRow[] {
  const dca = (id: string) => {
    const d = show.dcas.find((x) => x.id === id);
    return d ? (d.name ? `${d.number} ${d.name}` : String(d.number)) : "";
  };
  const mute = (id: string) => {
    const g = show.muteGroups.find((x) => x.id === id);
    return g ? (g.name ? `${g.number} ${g.name}` : String(g.number)) : "";
  };
  return show.inputs.map((c) => ({
    id: c.id,
    color: c.color,
    cells: {
      ch: c.number,
      source: c.source,
      shortName: c.shortName,
      performer: c.performer,
      mic: micName(show, c),
      stand: resolveStand(show, c) || (c.stand === "" ? "없음" : ""),
      phantom: resolvePhantom(show, c) ? "48V" : "",
      port: c.port ? formatPort(c.port, show.stageBoxes) : "",
      link: c.stereoLinkNext ? `↔${c.number + 1}` : "",
      color: c.color === "none" ? "" : COLOR_LABEL[c.color],
      dca: c.dcaIds.map(dca).join(", "),
      mute: c.muteGroupIds.map(mute).join(", "),
      notes: c.notes,
    },
  }));
}

/* ───────────── 아웃풋 리스트 ───────────── */

export const OUTPUT_REPORT_COLUMNS: ReportColumn[] = [
  { key: "bus", label: "버스", width: 8, default: true },
  { key: "name", label: "이름", width: 16, default: true },
  { key: "purpose", label: "용도", width: 9, default: true },
  { key: "width", label: "M/S", width: 6, align: "center", default: true },
  { key: "tap", label: "Pre/Post", width: 6, align: "center", default: true },
  { key: "sources", label: "소스", width: 12, default: true },
  { key: "ports", label: "물리 출력", width: 18, default: true },
  { key: "notes", label: "비고", width: 20, default: true },
];

const KIND_TITLE: Record<BusKind, string> = { aux: "Aux / Mix", matrix: "Matrix", main: "Main" };

export function outputReportSections(show: Show): { title: string; rows: ReportRow[] }[] {
  const row = (b: OutputBus): ReportRow => ({
    id: b.id,
    cells: {
      bus: b.kind === "main" ? "Main" : busShort(b),
      name: b.name,
      purpose: b.purpose === "other" ? "" : BUS_PURPOSE_LABEL[b.purpose],
      width: b.width === "stereo" ? "St" : "M",
      tap: b.kind === "aux" ? (b.tap === "pre" ? "Pre" : "Post") : "",
      sources: b.sources.map((id) => show.outputs.find((x) => x.id === id)).filter(Boolean).map((x) => busShort(x!)).join(", "),
      ports: formatOutPorts(show, b.ports),
      notes: b.notes,
    },
  });
  return (["aux", "matrix", "main"] as BusKind[])
    .map((k) => ({ title: KIND_TITLE[k], rows: busesOf(show, k).map(row) }))
    .filter((s) => s.rows.length);
}

/* ───────────── 패치 시트 ───────────── */

export interface PatchSlot {
  port: number;
  /** 큰 글씨: 채널 번호 또는 버스 */
  main: string;
  /** 짧은 이름 / 버스 이름 */
  name: string;
  /** 작은 글씨: 소스·마이크·48V 등 */
  detail: string;
  color?: Color;
  /** 두 채널이 같은 포트 등 */
  conflict?: boolean;
}

export const PATCH_ROWS_PER_COLUMN = 16;

/** 박스 하나의 인풋·아웃풋 포트 목록 (빈 포트 포함, 범위를 넘는 포트도 표시) */
export function patchSheet(show: Show, boxId: string): { ins: PatchSlot[]; outs: PatchSlot[] } {
  const box = show.stageBoxes.find((b) => b.id === boxId)!;
  const inMap = new Map<number, typeof show.inputs>();
  show.inputs.forEach((c) => {
    if (c.port?.kind === "stagebox" && c.port.stageBoxId === boxId) inMap.set(c.port.port, [...(inMap.get(c.port.port) ?? []), c]);
  });
  const outMap = new Map<number, { bus: OutputBus; side: number }[]>();
  show.outputs.forEach((b) =>
    b.ports.forEach((p, side) => {
      if (p.kind === "stagebox" && p.stageBoxId === boxId) outMap.set(p.port, [...(outMap.get(p.port) ?? []), { bus: b, side }]);
    }),
  );
  const maxIn = Math.max(box.inputs, ...inMap.keys());
  const maxOut = Math.max(box.outputs, ...outMap.keys());
  const ins: PatchSlot[] = Array.from({ length: maxIn }, (_, i) => {
    const port = i + 1;
    const chs = inMap.get(port) ?? [];
    const c = chs[0];
    if (!c) return { port, main: "", name: "", detail: "" };
    return {
      port,
      main: chs.map((x) => x.number).join("+"),
      name: c.shortName || c.source,
      detail: [c.source !== c.shortName ? c.source : "", micName(show, c), resolvePhantom(show, c) ? "48V" : "", resolveStand(show, c)]
        .filter(Boolean)
        .join(" · "),
      color: c.color,
      conflict: chs.length > 1 || port > box.inputs,
    };
  });
  const outs: PatchSlot[] = Array.from({ length: maxOut }, (_, i) => {
    const port = i + 1;
    const us = outMap.get(port) ?? [];
    const u = us[0];
    if (!u) return { port, main: "", name: "", detail: "" };
    const side = u.bus.width === "stereo" ? (u.side === 0 ? " L" : u.side === 1 ? " R" : "") : "";
    return {
      port,
      main: (u.bus.kind === "main" ? "Main" : busShort(u.bus)) + side,
      name: u.bus.name,
      detail: [u.bus.purpose === "other" ? "" : BUS_PURPOSE_LABEL[u.bus.purpose], u.bus.notes].filter(Boolean).join(" · "),
      conflict: us.length > 1 || port > box.outputs,
    };
  });
  return { ins, outs };
}

/* ───────────── 장비 집계 ───────────── */

export interface EquipmentSummary {
  mics: { model: string; type: MicType | null; count: number; owned: number | null; channels: number[] }[];
  stands: { stand: string; count: number; channels: number[] }[];
  di: { active: number; passive: number; unknown: number; total: number };
  /** 무선 채널 (수신기 채널 수 = 무선 마이크를 쓴 인풋 채널). 핸드헬드/바디팩은 모델 이름으로 나눈다 */
  wireless: { total: number; handheld: number; bodypack: number; channels: number[] };
  cables: { kind: string; count: number; withSpare: number; note: string }[];
  spare: number;
}

/**
 * 집계. 케이블 수는 연결 수 기준의 추정이다(길이는 무대 배치에 따라 다르므로 세지 않음):
 * - 마이크·DI → 박스: 패치된 인풋 채널마다 XLR 1 (무선은 수신기 → 박스 XLR)
 * - DI 입력: DI 채널마다 악기 케이블(TS) 1
 * - 박스 → 스피커·앰프·IEM: 사용하는 출력 포트마다 XLR 1
 */
export function equipmentSummary(show: Show, lib: Library | null, sparePercent = 10): EquipmentSummary {
  const mics = new Map<string, EquipmentSummary["mics"][number]>();
  const stands = new Map<string, EquipmentSummary["stands"][number]>();
  const di = { active: 0, passive: 0, unknown: 0, total: 0 };
  const wireless = { total: 0, handheld: 0, bodypack: 0, channels: [] as number[] };
  let xlrMic = 0;
  let xlrWireless = 0;
  let ts = 0;
  for (const c of show.inputs) {
    const name = micName(show, c);
    const ref = c.mic;
    const snap = ref?.kind === "library" ? show.microphones.find((m) => m.id === ref.microphoneId) : undefined;
    if (name) {
      const cur = mics.get(name) ?? { model: name, type: snap?.type ?? null, count: 0, owned: lib ? (libMicOf(lib, show, c)?.owned ?? null) : null, channels: [] };
      cur.count++;
      cur.channels.push(c.number);
      mics.set(name, cur);
    }
    const stand = resolveStand(show, c);
    if (stand) {
      const cur = stands.get(stand) ?? { stand, count: 0, channels: [] };
      cur.count++;
      cur.channels.push(c.number);
      stands.set(stand, cur);
    }
    if (snap?.type === "wireless") {
      wireless.total++;
      wireless.channels.push(c.number);
      if (/바디팩|bodypack|beltpack|\bSK\b/i.test(snap.model)) wireless.bodypack++;
      else wireless.handheld++;
    }
    if (snap?.type === "di") {
      di.total++;
      ts++;
      if (snap.needsPhantom === true) di.active++;
      else if (snap.needsPhantom === false) di.passive++;
      else di.unknown++;
    }
    if (c.port && c.port.kind !== "other" && c.mic) {
      if (snap?.type === "wireless") xlrWireless++;
      else xlrMic++;
    }
  }
  const outPorts = new Set(
    show.outputs.flatMap((b) => b.ports.flatMap((p) => (p.kind === "other" ? [] : [p.kind === "stagebox" ? `${p.stageBoxId}:${p.port}` : `${p.kind}:${p.port}`]))),
  ).size;
  const spare = (n: number) => (n ? Math.ceil(n * (1 + sparePercent / 100)) : 0);
  const cables = [
    { kind: "XLR (마이크·DI → 박스)", count: xlrMic, note: "패치된 유선 마이크·DI 채널" },
    { kind: "XLR (무선 수신기 → 박스)", count: xlrWireless, note: "무선 채널" },
    { kind: "악기 케이블 TS (악기 → DI)", count: ts, note: "DI 채널" },
    { kind: "XLR (박스 → 스피커·앰프·IEM)", count: outPorts, note: "사용하는 출력 포트" },
  ]
    .filter((c) => c.count)
    .map((c) => ({ ...c, withSpare: spare(c.count) }));
  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    mics: [...mics.values()].sort(byCount),
    stands: [...stands.values()].sort(byCount),
    di,
    wireless,
    cables,
    spare: sparePercent,
  };
}

export const micTypeLabel = (t: MicType | null) => (t ? MIC_TYPE_LABEL[t] : "");

/* ───────────── 라벨 ───────────── */

export interface ChannelLabel {
  ch: number;
  name: string;
  source: string;
  port: string;
  mic: string;
  color: Color;
}

export function channelLabels(show: Show): ChannelLabel[] {
  return show.inputs.map((c) => ({
    ch: c.number,
    name: c.shortName || c.source,
    source: c.source,
    port: c.port ? formatPort(c.port, show.stageBoxes) : "",
    mic: micName(show, c),
    color: c.color,
  }));
}

/** 라벨지 규격 (mm). 칸 크기·여백은 라벨지 포장에 적힌 값으로 바꿀 수 있다. */
export interface LabelSheet {
  id: string;
  name: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  top: number;
  left: number;
  /** 칸 사이 간격 */
  gapX: number;
  gapY: number;
}

/** A4 라벨지 (Avery L 시리즈 치수. 같은 크기의 국내 라벨지에도 맞을 수 있으나 테스트 인쇄로 확인) */
export const LABEL_SHEETS: LabelSheet[] = [
  { id: "l7651", name: "65칸 38.1×21.2mm (Avery L7651)", cols: 5, rows: 13, width: 38.1, height: 21.2, top: 10.7, left: 4.75, gapX: 2.54, gapY: 0 },
  { id: "l7159", name: "24칸 63.5×33.9mm (Avery L7159)", cols: 3, rows: 8, width: 63.5, height: 33.9, top: 12.9, left: 6.45, gapX: 2.54, gapY: 0 },
  { id: "l7160", name: "21칸 63.5×38.1mm (Avery L7160)", cols: 3, rows: 7, width: 63.5, height: 38.1, top: 15.15, left: 7.2, gapX: 2.54, gapY: 0 },
  { id: "l7163", name: "14칸 99.1×38.1mm (Avery L7163)", cols: 2, rows: 7, width: 99.1, height: 38.1, top: 15.15, left: 4.65, gapX: 2.5, gapY: 0 },
];

/* ───────────── CSV ───────────── */

const csvCell = (v: Cell) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 엑셀에서 한글이 깨지지 않게 BOM을 붙인다 */
export function toCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => columns.map((c) => csvCell(r.cells[c.key] ?? "")).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/* ───────────── 48V 체크리스트 ───────────── */

export const PHANTOM_CHECK_COLUMNS: ReportColumn[] = [
  { key: "check", label: "✓", width: 5, align: "center" },
  { key: "port", label: "포트", width: 16 },
  { key: "ch", label: "Ch", width: 6, align: "center" },
  { key: "source", label: "소스", width: 30 },
  { key: "mic", label: "마이크/DI", width: 30 },
];

/** 포트 순서: 박스(표 순서) → 콘솔 본체(OMNI) → Dante 직결 → 기타 → 패치 안 함 */
function portOrder(show: Show, c: Show["inputs"][number]): [number, number, string] {
  const p = c.port;
  if (!p) return [show.stageBoxes.length + 3, c.number, ""];
  if (p.kind === "stagebox") {
    const i = show.stageBoxes.findIndex((b) => b.id === p.stageBoxId);
    return [i < 0 ? show.stageBoxes.length : i, p.port, ""];
  }
  if (p.kind === "local") return [show.stageBoxes.length, p.port, ""];
  if (p.kind === "dante") return [show.stageBoxes.length + 1, p.port, ""];
  return [show.stageBoxes.length + 2, 0, p.label];
}

/**
 * 48V 체크리스트: 팬텀이 필요한 채널만 포트 순서로 (마이크를 꽂은 뒤 콘솔에서 켜며 체크).
 * 리본처럼 48V를 걸면 안 되는 채널은 따로 묶는다.
 */
export function phantomChecklist(show: Show): { on: ReportRow[]; never: ReportRow[] } {
  const row = (c: Show["inputs"][number], check: string): ReportRow => ({
    id: c.id,
    color: c.color,
    cells: { check, port: c.port ? formatPort(c.port, show.stageBoxes) : "(패치 안 함)", ch: c.number, source: c.source, mic: micName(show, c) },
  });
  const sorted = show.inputs
    .filter((c) => c.source.trim() || c.mic || c.port)
    .slice()
    .sort((a, b) => {
      const [x1, y1, z1] = portOrder(show, a);
      const [x2, y2, z2] = portOrder(show, b);
      return x1 - x2 || y1 - y2 || z1.localeCompare(z2) || a.number - b.number;
    });
  const isRibbon = (c: Show["inputs"][number]) => {
    const ref = c.mic;
    const m = ref?.kind === "library" ? show.microphones.find((x) => x.id === ref.microphoneId) : undefined;
    return m?.type === "ribbon" && m.needsPhantom !== true;
  };
  return {
    on: sorted.filter((c) => resolvePhantom(show, c) && !isRibbon(c)).map((c) => row(c, "☐")),
    never: sorted.filter(isRibbon).map((c) => row(c, "✕")),
  };
}
