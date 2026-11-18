/** Show → 엑셀(시트 여러 개) / CSV. 인쇄물과 같은 데이터(model/reports)를 쓴다. */
import { COLOR_SWATCH } from "@/model/labels";
import type { Library } from "@/model/library";
import {
  equipmentSummary,
  INPUT_REPORT_COLUMNS,
  inputReportRows,
  micTypeLabel,
  OUTPUT_REPORT_COLUMNS,
  outputReportSections,
  patchSheet,
  toCsv,
  type ReportColumn,
} from "@/model/reports";
import type { Show } from "@/model/schema";
import { buildXlsx, type XSheet } from "./xlsx";

const hex = (c?: string) => (c && c !== "none" ? COLOR_SWATCH[c as keyof typeof COLOR_SWATCH].replace("#", "").toUpperCase() : null);

export function showTitleLines(show: Show): string[] {
  return [show.title, [show.date, show.venue, show.version && `버전 ${show.version}`, show.author && `작성 ${show.author}`].filter(Boolean).join(" · ")];
}

export function buildShowXlsx(show: Show, lib: Library | null, inputCols: ReportColumn[] = INPUT_REPORT_COLUMNS, sparePercent = 10): Uint8Array {
  const title = showTitleLines(show);
  const inRows = inputReportRows(show);
  const sheets: XSheet[] = [
    {
      name: "인풋리스트",
      title,
      columns: inputCols.map((c) => ({ label: c.label, width: Math.max(6, c.width * 1.6) })),
      rows: inRows.map((r) => inputCols.map((c) => r.cells[c.key])),
      rowFill: inRows.map((r) => hex(r.color)),
    },
  ];

  const outCols = [{ key: "section", label: "구분", width: 6 } as ReportColumn, ...OUTPUT_REPORT_COLUMNS];
  const outRows = outputReportSections(show).flatMap((s) => s.rows.map((r) => ({ ...r, cells: { ...r.cells, section: s.title } as Record<string, string | number> })));
  sheets.push({
    name: "아웃풋",
    title,
    columns: outCols.map((c) => ({ label: c.label, width: Math.max(6, c.width * 1.6) })),
    rows: outRows.map((r) => outCols.map((c) => r.cells[c.key])),
  });

  for (const box of show.stageBoxes) {
    const { ins, outs } = patchSheet(show, box.id);
    sheets.push({
      name: `패치 ${box.name}`,
      title: [...title, `${box.name} ${box.location}`.trim()],
      columns: [{ label: "방향", width: 7 }, { label: "포트", width: 6 }, { label: "채널/버스", width: 10 }, { label: "이름", width: 18 }, { label: "상세", width: 50 }],
      rows: [
        ...ins.map((s) => ["인풋", s.port, s.main, s.name, s.detail]),
        ...outs.map((s) => ["아웃풋", s.port, s.main, s.name, s.detail]),
      ],
      rowFill: [...ins.map((s) => hex(s.color)), ...outs.map(() => null)],
    });
  }

  const eq = equipmentSummary(show, lib, sparePercent);
  sheets.push({
    name: "장비 집계",
    title,
    columns: [{ label: "구분", width: 10 }, { label: "항목", width: 32 }, { label: "수량", width: 8 }, { label: "보유/여분 포함", width: 14 }, { label: "비고", width: 50 }],
    rows: [
      ...eq.mics.map((m) => ["마이크·DI", `${m.model}${m.type ? ` (${micTypeLabel(m.type)})` : ""}`, m.count, m.owned ?? "", `Ch ${m.channels.join(", ")}`]),
      ...eq.stands.map((s) => ["스탠드", s.stand, s.count, "", `Ch ${s.channels.join(", ")}`]),
      ["DI", "액티브 / 패시브 / 미확인", eq.di.total, "", `${eq.di.active} / ${eq.di.passive} / ${eq.di.unknown}`],
      ...eq.cables.map((c) => ["케이블", c.kind, c.count, c.withSpare, `${c.note} · 여분 ${eq.spare}%`]),
    ],
  });
  return buildXlsx(sheets);
}

export { toCsv };

/** 파일 이름에 쓸 수 없는 문자를 바꾼다 */
export function fileBase(show: Show, doc: string): string {
  return [show.date, show.title, doc, show.version].filter(Boolean).join("_").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}
