/** 엑셀/구글시트 ↔ 인풋리스트 복사·붙여넣기 (TSV) */
import { COLUMNS, matchHeader, type ColCtx, type Column } from "./inputColumns";
import { newChannel, nextNumber, withInputs } from "./inputOps";
import type { Show } from "./schema";

/** 엑셀 클립보드 TSV 파싱 (따옴표 안의 줄바꿈·탭 처리) */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function toTsv(rows: string[][]): string {
  const q = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join("\t")).join("\n");
}

export interface PasteResult {
  show: Show;
  /** 붙여넣은 데이터 행 수 */
  rowCount: number;
  /** 헤더로 인식된 경우: 원본 헤더 → 열 이름 */
  headerMap?: { from: string; to: string | null }[];
  /** 인식할 수 없어 건너뛴 값 */
  skipped: string[];
}

/**
 * startRow 행, startCol 열부터 붙여넣는다. 남는 행은 새 채널로 추가.
 * 첫 줄이 헤더(인식되는 열 이름 2개 이상)면 헤더 기준으로 열을 맞추고 startCol은 무시.
 */
export function applyPaste(
  show: Show,
  startRow: number,
  startCol: number,
  text: string,
  ctx?: ColCtx,
): PasteResult {
  let rows = parseTsv(text);
  let cols: (Column | null)[];
  let headerMap: PasteResult["headerMap"];

  const header = rows[0]?.map(matchHeader) ?? [];
  if (header.filter(Boolean).length >= 2) {
    // 같은 열에 두 헤더가 걸리면 첫 번째만 쓴다
    const used = new Set<string>();
    cols = header.map((c) => (c && !used.has(c.key) ? (used.add(c.key), c) : null));
    headerMap = rows[0].map((h, j) => ({ from: h, to: cols[j]?.label ?? null }));
    rows = rows.slice(1);
  } else {
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    cols = Array.from({ length: width }, (_, j) => COLUMNS[startCol + j] ?? null);
  }

  rows = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const skipped: string[] = [];
  // Ch 열을 먼저 적용해야 번호 중복 판단 등이 자연스럽다
  const order = cols
    .map((c, j) => ({ c, j }))
    .filter((x): x is { c: Column; j: number } => x.c !== null)
    .sort((a, b) => (a.c.key === "ch" ? -1 : 0) - (b.c.key === "ch" ? -1 : 0));

  let s = show;
  rows.forEach((cells, r) => {
    const index = startRow + r;
    if (index >= s.inputs.length) {
      s = withInputs(s, [...s.inputs, newChannel(nextNumber(s.inputs))]);
    }
    for (const { c, j } of order) {
      const value = cells[j] ?? "";
      if (c.key === "ch" && value.trim() === "") continue;
      const next = c.set(s, index, value, ctx);
      if (next) s = next;
      else skipped.push(`${index + 1}행 ${c.label}: "${value}"`);
    }
  });

  return { show: s, rowCount: rows.length, headerMap, skipped };
}
