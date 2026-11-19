/**
 * 크루 공유 내용(SharePayload) 만들기 — 순수 함수.
 * 크루 화면은 이 값만 받아 그린다(마이크 이름·패치 표시 등은 이미 사람이 읽는 문자열). 편집 데이터(Show)는 보내지 않는다.
 * 변경 표시: 비교 기준(지난 공유본 또는 버전)과의 차이를 칸 단위로 함께 담는다 (11단계 diffShows 그대로).
 */
import { z } from "zod";
import type { Show } from "./schema";
import { ColorSchema } from "./schema";
import { INPUT_REPORT_COLUMNS, inputReportRows, OUTPUT_REPORT_COLUMNS, outputReportSections } from "./reports";
import { diffShows, type RowChange } from "./versions";

export const SHARE_VERSION = 1;
/** 서버가 받는 최대 크기 (바이트) */
export const SHARE_MAX_BYTES = 300_000;

const Cells = z.record(z.string(), z.union([z.string(), z.number()]));
const Row = z.object({
  id: z.string(),
  cells: Cells,
  color: ColorSchema.optional(),
  /** 바뀐 칸: 칸 key → 이전 값 */
  changed: z.record(z.string(), z.string()).optional(),
  added: z.boolean().optional(),
});
export const SharePayloadSchema = z.object({
  v: z.literal(SHARE_VERSION),
  title: z.string(),
  date: z.string(),
  venue: z.string(),
  author: z.string(),
  version: z.string(),
  publishedAt: z.string(),
  /** 변경 표시 기준 (없으면 표시 안 함) */
  base: z.object({ label: z.string(), at: z.string() }).nullable(),
  inputs: z.array(Row),
  outputs: z.array(Row.extend({ section: z.string(), kind: z.enum(["aux", "matrix", "main"]), purpose: z.string() })),
  groups: z.array(z.object({ kind: z.enum(["dca", "mute"]), number: z.number(), name: z.string(), changed: z.boolean().optional() })),
  boxes: z.array(z.object({ name: z.string(), inputs: z.number(), outputs: z.number(), location: z.string() })),
  removed: z.object({ inputs: z.array(z.string()), outputs: z.array(z.string()) }),
  changeCount: z.number(),
  /** 칸 이름 (크루 화면이 모델 코드를 받지 않아도 되게) */
  columns: z.object({ inputs: z.array(z.object({ key: z.string(), label: z.string() })), outputs: z.array(z.object({ key: z.string(), label: z.string() })) }),
});
export type SharePayload = z.infer<typeof SharePayloadSchema>;
export type ShareRow = SharePayload["inputs"][number];

const keyOf = (cols: { key: string; label: string }[]) => new Map(cols.map((c) => [c.label, c.key]));

function changedCells(r: RowChange | undefined, keys: Map<string, string>): Pick<ShareRow, "changed" | "added"> {
  if (!r) return {};
  if (r.kind === "added") return { added: true };
  return { changed: Object.fromEntries(r.fields.map((f) => [keys.get(f.field) ?? f.field, f.before])) };
}

export function buildSharePayload(show: Show, base: { show: Show; label: string; at: string } | null, publishedAt = new Date().toISOString()): SharePayload {
  const diff = base ? diffShows(base.show, show) : null;
  const byId = (list: RowChange[] | undefined) => new Map((list ?? []).filter((r) => r.kind !== "removed").map((r) => [r.id, r]));
  const inChanges = byId(diff?.inputs);
  const outChanges = byId(diff?.outputs);
  const inKeys = keyOf(INPUT_REPORT_COLUMNS);
  const outKeys = keyOf(OUTPUT_REPORT_COLUMNS);
  const changedGroups = new Set((diff?.groups ?? []).filter((g) => g.kind !== "removed").map((g) => g.id));
  return {
    v: SHARE_VERSION,
    title: show.title,
    date: show.date,
    venue: show.venue,
    author: show.author,
    version: show.version,
    publishedAt,
    base: base ? { label: base.label, at: base.at } : null,
    inputs: inputReportRows(show).map((r) => ({ id: r.id!, cells: r.cells, color: r.color, ...changedCells(inChanges.get(r.id!), inKeys) })),
    outputs: outputReportSections(show).flatMap((sec) =>
      sec.rows.map((r) => {
        const bus = show.outputs.find((b) => b.id === r.id)!;
        return { id: r.id!, section: sec.title, kind: bus.kind, purpose: bus.purpose, cells: r.cells, ...changedCells(outChanges.get(r.id!), outKeys) };
      }),
    ),
    groups: [
      ...show.dcas.map((d) => ({ kind: "dca" as const, number: d.number, name: d.name, changed: changedGroups.has(d.id) || undefined })),
      ...show.muteGroups.map((g) => ({ kind: "mute" as const, number: g.number, name: g.name, changed: changedGroups.has(g.id) || undefined })),
    ],
    boxes: show.stageBoxes.map((b) => ({ name: b.name, inputs: b.inputs, outputs: b.outputs, location: b.location })),
    removed: {
      inputs: (diff?.inputs ?? []).filter((r) => r.kind === "removed").map((r) => r.label),
      outputs: (diff?.outputs ?? []).filter((r) => r.kind === "removed").map((r) => r.label),
    },
    changeCount: diff ? diff.inputs.length + diff.outputs.length + diff.groups.length : 0,
    columns: {
      inputs: INPUT_REPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
      outputs: OUTPUT_REPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
    },
  };
}

