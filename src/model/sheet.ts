/**
 * 표(시트) 공통: 열 정의와 엑셀 붙여넣기.
 * 아웃풋·DCA·뮤트 그룹 표가 같은 키보드 그리드(components/Sheet)를 쓰도록 열을 이 모양으로 정의한다.
 * (인풋 그리드는 2단계의 inputColumns를 그대로 쓴다)
 */
import type { ReactNode } from "react";
import type { RowOps } from "./outputOps";
import { parseTsv } from "./inputPaste";
import type { Show } from "./schema";
import { norm } from "./text";

export interface SheetColumn<T> {
  key: string;
  label: string;
  /** 엑셀 헤더 인식용 별칭 */
  aliases: string[];
  width?: string;
  /** 켜고 끄는 열 (Space/Enter로 뒤집기). value가 현재 상태 */
  toggle?: { value(row: T): boolean; on: string; off: string };
  /** 셀을 누르거나 Space를 누르면 선택 창을 연다 */
  pick?: boolean;
  /** 화면 표시·복사 텍스트 */
  text(show: Show, row: T): string;
  /** Enter로 편집 시작할 때 */
  editText?(show: Show, row: T): string;
  /** 텍스트 적용 (index는 표 안의 행). 인식할 수 없으면 null */
  set(show: Show, index: number, text: string): Show | null;
  suggestions?(show: Show): string[];
  render?(show: Show, row: T): ReactNode;
  /** Delete로 지울 수 없는 열 (번호 등) */
  noClear?: boolean;
  /** 보기만 하는 열 (계산값) */
  readOnly?: boolean;
}

export function matchSheetHeader<T>(cols: SheetColumn<T>[], cell: string): SheetColumn<T> | null {
  const n = norm(cell);
  if (!n) return null;
  return cols.find((c) => norm(c.label) === n || c.aliases.some((a) => norm(a) === n)) ?? null;
}

/**
 * 붙여넣기: 첫 줄이 헤더(인식되는 열 2개 이상)면 이름으로, 아니면 startCol부터 순서대로.
 * 표 끝을 넘는 행은 새로 추가한다. 번호 열을 먼저 적용한다.
 */
export function sheetPaste<T>(
  show: Show,
  cols: SheetColumn<T>[],
  ops: RowOps,
  startRow: number,
  startCol: number,
  text: string,
) {
  let rows = parseTsv(text);
  let map: (SheetColumn<T> | null)[];
  let headerMap: { from: string; to: string | null }[] | undefined;
  const header = rows[0]?.map((c) => matchSheetHeader(cols, c)) ?? [];
  if (header.filter(Boolean).length >= 2) {
    const used = new Set<string>();
    map = header.map((c) => (c && !used.has(c.key) ? (used.add(c.key), c) : null));
    headerMap = rows[0].map((h, j) => ({ from: h, to: map[j]?.label ?? null }));
    rows = rows.slice(1);
  } else {
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    map = Array.from({ length: width }, (_, j) => cols[startCol + j] ?? null).map((c) => (c?.readOnly ? null : c));
  }
  rows = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const order = map
    .map((c, j) => ({ c, j }))
    .filter((x): x is { c: SheetColumn<T>; j: number } => x.c !== null)
    .sort((a, b) => (a.c.key === "num" ? -1 : 0) - (b.c.key === "num" ? -1 : 0));
  const skipped: string[] = [];
  let s = show;
  rows.forEach((cells, r) => {
    const index = startRow + r;
    while (index >= ops.count(s)) s = ops.append(s);
    for (const { c, j } of order) {
      const v = cells[j] ?? "";
      if (c.key === "num" && v.trim() === "") continue;
      const next = c.set(s, index, v);
      if (next) s = next;
      else skipped.push(`${index + 1}행 ${c.label}: "${v}"`);
    }
  });
  return { show: s, rowCount: rows.length, headerMap, skipped };
}

/**
 * 편집 칸의 후보 목록 거르기 (인풋 그리드·공통 표가 같이 쓴다).
 * - 편집을 막 시작해 칸의 글자가 원래 값 그대로면 거르지 않고 전부 보여준다.
 *   (마이크가 들어 있는 칸에서 다른 모델·DI로 바꿀 때 지우지 않고 바로 고를 수 있게)
 * - 글자를 고치면 후보 이름이나 덧붙인 검색어(keys: 종류 "DI", "무선" 등)에 들어 있는 것만.
 */
export function filterSuggestions(
  all: string[],
  text: string,
  startText: string | null,
  keys?: (value: string) => string,
  limit = 300,
): string[] {
  const q = text.trim().toLowerCase();
  const unique = [...new Set(all)];
  if (startText !== null && q === startText.trim().toLowerCase()) return unique.slice(0, limit);
  return unique
    .filter((s) => {
      const v = s.toLowerCase();
      if (v === q) return false;
      return v.includes(q) || (keys ? keys(s).toLowerCase().includes(q) : false);
    })
    .slice(0, limit);
}
