/**
 * 버전(이름 붙인 스냅샷)과 버전 비교 — 순수 함수. 저장은 src/storage/versionStore.ts.
 * 비교는 출력물과 같은 사람이 읽는 값(인쇄용 행)으로 한다: 마이크 이름, 패치 표시, DCA 이름 …
 * 채널·버스는 id로 맞추고, id가 다르면 같은 번호끼리 맞춘다.
 */
import type { Show } from "./schema";
import { formatPort } from "./labels";
import { fingerprint } from "./backup";
import { INPUT_REPORT_COLUMNS, inputReportRows, OUTPUT_REPORT_COLUMNS, outputReportSections, type ReportRow } from "./reports";
import { busShort } from "./outputColumns";

export interface VersionMeta {
  id: string;
  showId: string;
  name: string;
  createdAt: string;
  inputs: number;
  outputs: number;
  /** 내용 지문 (같은 내용인지 빠르게 비교) */
  fp: string;
}

/** 내용 비교용: 저장 시각만 뺀다 */
export function contentFingerprint(show: Show): string {
  const { updatedAt: _u, createdAt: _c, ...rest } = show;
  void _u;
  void _c;
  return fingerprint(JSON.stringify(rest));
}

export function metaOf(id: string, name: string, show: Show, createdAt = new Date().toISOString()): VersionMeta {
  return { id, showId: show.id, name, createdAt, inputs: show.inputs.length, outputs: show.outputs.length, fp: contentFingerprint(show) };
}

/** 다음 버전 이름 제안: 마지막이 "v2 리허설 후"면 "v3 " */
export function suggestVersionName(versions: readonly Pick<VersionMeta, "name">[]): string {
  const nums = versions.map((v) => /^v(\d+)/i.exec(v.name.trim())?.[1]).filter(Boolean).map(Number);
  return `v${(nums.length ? Math.max(...nums) : versions.length) + 1} `;
}

/**
 * 비교 기준 고르기 (바뀐 행 표시·변경분 인쇄의 기본값):
 * 지금 내용이 마지막 버전과 같으면 그 앞 버전, 다르면 마지막 버전. versions는 최근 것이 앞.
 */
export function defaultBase(versions: readonly VersionMeta[], currentFp: string): VersionMeta | null {
  if (!versions.length) return null;
  return versions[0].fp === currentFp ? (versions[1] ?? null) : versions[0];
}

/** 지금 내용과 같은 버전 (머리말에 버전 이름·날짜) */
export function currentVersion(versions: readonly VersionMeta[], currentFp: string): VersionMeta | null {
  return versions.find((v) => v.fp === currentFp) ?? null;
}

/* ───────────── 비교 ───────────── */

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface RowChange {
  /** 채널·버스 id 등 (바뀐 행 표시용) */
  id: string;
  kind: "added" | "removed" | "changed";
  /** 표시 (Ch 3 Snare Top, Mix 1 Vo Wedge …) */
  label: string;
  fields: FieldChange[];
}

export interface ShowDiff {
  info: FieldChange[];
  inputs: RowChange[];
  outputs: RowChange[];
  patch: RowChange[];
  groups: RowChange[];
  total: number;
}

export const DIFF_SECTIONS: { key: keyof Omit<ShowDiff, "info" | "total">; title: string }[] = [
  { key: "inputs", title: "인풋" },
  { key: "outputs", title: "아웃풋" },
  { key: "patch", title: "패치" },
  { key: "groups", title: "DCA·뮤트" },
];

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** 행 목록 비교: id로, 안 맞으면 key(번호)로 짝짓기 */
function diffRows<T>(
  a: T[],
  b: T[],
  id: (x: T) => string,
  key: (x: T) => string,
  label: (x: T) => string,
  fields: { key: string; label: string; get: (x: T) => string }[],
): RowChange[] {
  const out: RowChange[] = [];
  const bLeft = new Map(b.map((x) => [id(x), x]));
  const pairs: [T, T][] = [];
  const aLeft: T[] = [];
  for (const x of a) {
    const y = bLeft.get(id(x));
    if (y) {
      pairs.push([x, y]);
      bLeft.delete(id(x));
    } else aLeft.push(x);
  }
  for (const x of aLeft) {
    const y = [...bLeft.values()].find((z) => key(z) === key(x));
    if (y) {
      pairs.push([x, y]);
      bLeft.delete(id(y));
    } else out.push({ id: id(x), kind: "removed", label: label(x), fields: [] });
  }
  for (const [x, y] of pairs) {
    const changed = fields.filter((f) => f.get(x) !== f.get(y)).map((f) => ({ field: f.label, before: f.get(x), after: f.get(y) }));
    if (changed.length) out.push({ id: id(y), kind: "changed", label: label(y), fields: changed });
  }
  for (const y of bLeft.values()) out.push({ id: id(y), kind: "added", label: label(y), fields: [] });
  return out;
}

const order = (r: RowChange[], pos: (id: string) => number) => [...r].sort((x, y) => pos(x.id) - pos(y.id));

export function diffShows(a: Show, b: Show): ShowDiff {
  const info: FieldChange[] = (
    [
      ["title", "공연명"],
      ["date", "날짜"],
      ["venue", "장소"],
      ["author", "작성자"],
      ["notes", "메모"],
    ] as const
  )
    .filter(([k]) => a[k] !== b[k])
    .map(([k, field]) => ({ field, before: a[k], after: b[k] }));

  // 인풋: 인풋리스트 행의 칸 그대로
  const ia = inputReportRows(a);
  const ib = inputReportRows(b);
  const inFields = INPUT_REPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label, get: (r: ReportRow) => str(r.cells[c.key]) }));
  const chLabel = (r: ReportRow) => `Ch ${r.cells.ch} ${r.cells.shortName || r.cells.source}`.trim();
  const inputs = order(
    diffRows(ia, ib, (r) => r.id!, (r) => str(r.cells.ch), chLabel, inFields),
    (id) => {
      const i = ib.findIndex((r) => r.id === id);
      return i >= 0 ? i : 1000 + ia.findIndex((r) => r.id === id);
    },
  );

  // 아웃풋: 아웃풋 리스트 행
  const oa = outputReportSections(a).flatMap((s) => s.rows);
  const ob = outputReportSections(b).flatMap((s) => s.rows);
  const outFields = OUTPUT_REPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label, get: (r: ReportRow) => str(r.cells[c.key]) }));
  const outputs = order(
    diffRows(oa, ob, (r) => r.id!, (r) => str(r.cells.bus), (r) => `${r.cells.bus} ${r.cells.name}`.trim(), outFields),
    (id) => {
      const i = ob.findIndex((r) => r.id === id);
      return i >= 0 ? i : 1000 + oa.findIndex((r) => r.id === id);
    },
  );

  // 패치: 스테이지박스 구성 + 포트마다 쓰는 채널·버스
  const boxFields = [
    { key: "name", label: "이름", get: (x: Show["stageBoxes"][number]) => x.name },
    { key: "io", label: "In/Out", get: (x: Show["stageBoxes"][number]) => `${x.inputs}/${x.outputs}` },
    { key: "location", label: "위치", get: (x: Show["stageBoxes"][number]) => x.location },
  ];
  const boxes = diffRows(a.stageBoxes, b.stageBoxes, (x) => x.id, (x) => x.name, (x) => `박스 ${x.name}`, boxFields);
  const occupancy = (s: Show) => {
    const m = new Map<string, string[]>();
    const put = (port: string, who: string) => m.set(port, [...(m.get(port) ?? []), who]);
    // 이름은 빼고 번호만: 이름이 바뀐 것은 인풋·아웃풋에서 보이고, 여기는 연결이 바뀐 것만
    for (const c of s.inputs) if (c.port) put(`IN ${formatPort(c.port, s.stageBoxes)}`, `Ch ${c.number}`);
    for (const o of s.outputs) for (const p of o.ports) put(`OUT ${formatPort(p, s.stageBoxes)}`, busShort(o));
    return m;
  };
  const pa = occupancy(a);
  const pb = occupancy(b);
  const ports = [...new Set([...pa.keys(), ...pb.keys()])]
    .filter((p) => (pa.get(p) ?? []).join(", ") !== (pb.get(p) ?? []).join(", "))
    .sort((x, y) => x.localeCompare(y, "ko", { numeric: true }))
    .map((p): RowChange => ({ id: `port:${p}`, kind: "changed", label: p, fields: [{ field: "사용", before: (pa.get(p) ?? []).join(", ") || "비어 있음", after: (pb.get(p) ?? []).join(", ") || "비어 있음" }] }));
  const patch = [...boxes, ...ports];

  // DCA·뮤트 그룹 (멤버는 인풋의 DCA·뮤트 칸으로 나온다)
  const g = (s: Show) => [
    ...s.dcas.map((d) => ({ id: d.id, key: `dca${d.number}`, label: `DCA ${d.number}`, name: d.name })),
    ...s.muteGroups.map((m) => ({ id: m.id, key: `mute${m.number}`, label: `뮤트 그룹 ${m.number}`, name: m.name })),
  ];
  const groups = diffRows(g(a), g(b), (x) => x.id, (x) => x.key, (x) => `${x.label} ${x.name}`.trim(), [
    { key: "label", label: "번호", get: (x) => x.label },
    { key: "name", label: "이름", get: (x) => x.name },
  ]);

  const total = info.length + inputs.length + outputs.length + patch.length + groups.length;
  return { info, inputs, outputs, patch, groups, total };
}

/** 바뀐 행 표시용: 비교 기준에서 바뀌었거나 새로 생긴 채널·버스 id */
export function changedRowIds(diff: ShowDiff): Set<string> {
  return new Set([...diff.inputs, ...diff.outputs].filter((r) => r.kind !== "removed").map((r) => r.id));
}
