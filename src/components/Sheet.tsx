"use client";

/**
 * 범용 키보드 그리드 — 아웃풋·DCA·뮤트 그룹 표가 쓴다. 조작은 2단계 인풋 그리드와 같다.
 * - 방향키·Tab 이동, 글자 입력으로 바로 덮어쓰기, Enter/F2 편집, Esc 취소
 * - Shift+방향키 범위 선택, ⌘/Ctrl+Enter 선택 행 일괄 입력, Delete 지우기
 * - ⌘/Ctrl+C/X/V (엑셀 호환, 헤더 인식), ⌘Z/⇧⌘Z
 * - ⌥N 삽입, ⌥D 복제, ⌥⌫ 삭제, ⌥↑↓ 순서 이동
 * - 켜고 끄는 열은 Space/Enter, 선택 창 열(번호 등)은 클릭 또는 Space
 * - 마지막 빈 행에 입력하면 새 항목, 표 끝에서 ↓/맨 위에서 ↑는 이웃 표로
 *
 * 포커스 모델은 인풋 그리드와 같다: 활성 셀 안의 <input> 하나가 키를 받는다(한글 IME 대응).
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { Show } from "@/model/schema";
import type { RowOps } from "@/model/outputOps";
import { parseTsv, toTsv } from "@/model/inputPaste";
import { sheetPaste, type SheetColumn } from "@/model/sheet";

type Pos = { r: number; c: number };
type Edit = { mode: "enter" | "edit"; text: string; sug: number };

export interface SheetHandle {
  focus(where: "top" | "bottom"): void;
}

interface Props<T> {
  /** 표 이름 (스크린리더·메시지용) */
  label: string;
  show: Show;
  rows: T[];
  rowKey: (row: T) => string;
  columns: SheetColumn<T>[];
  ops: RowOps;
  apply: (fn: (s: Show) => Show) => void;
  undo: () => void;
  redo: () => void;
  renumber: boolean;
  /** `${행}:${열 key}` → 문제 설명 */
  issues?: Map<string, string>;
  onMessage: (text: string, details?: string[]) => void;
  /** 선택 창 열기 (pick 열 클릭 또는 Space) */
  onPick?: (row: number, colKey: string) => void;
  /** 표 위·아래 끝에서 빠져나가기 (이웃 표로 포커스) */
  onExit?: (dir: -1 | 1) => void;
  handle?: Ref<SheetHandle>;
  autoFocus?: boolean;
  /** 키를 받지 않게 (선택 창이 열려 있을 때) */
  paused?: boolean;
  /** 선택 창이 따라가게 할 활성 행 (외부에서 지정) */
  activeRow?: number | null;
}

export default function Sheet<T>({
  label,
  show,
  rows,
  rowKey,
  columns,
  ops,
  apply,
  undo,
  redo,
  renumber,
  issues,
  onMessage,
  onPick,
  onExit,
  handle,
  autoFocus,
  paused,
  activeRow,
}: Props<T>) {
  const n = rows.length;
  const rowCount = n + 1;
  const LAST = columns.length - 1;
  const firstText = Math.min(1, LAST);
  const [active, setActive] = useState<Pos>({ r: 0, c: firstText });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: firstText });
  const [edit, setEditState] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  const setEdit = (e: Edit | null) => {
    editRef.current = e;
    setEditState(e);
  };
  const [tabStart, setTabStart] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCellRef = useRef<HTMLTableCellElement>(null);
  const wantFocus = useRef(!!autoFocus);
  const [focused, setFocused] = useState(false);

  const clampR = (r: number) => Math.max(0, Math.min(rowCount - 1, r));
  const a = { r: clampR(active.r), c: Math.min(active.c, LAST) };
  const b = { r: clampR(anchor.r), c: Math.min(anchor.c, LAST) };
  const sel = { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
  const dataR1 = Math.min(sel.r1, n - 1);
  const selRows = sel.r0 <= dataR1 ? range(sel.r0, dataR1) : [];

  // 외부(선택 창)가 활성 행을 옮길 때
  useEffect(() => {
    if (activeRow === null || activeRow === undefined) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setActive((p) => ({ r: activeRow, c: p.c }));
    setAnchor((p) => ({ r: activeRow, c: p.c }));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activeRow]);

  useEffect(() => {
    if (paused) return;
    if (!wantFocus.current) return;
    inputRef.current?.focus({ preventScroll: true });
    activeCellRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [a.r, a.c, n, paused]);

  /* ───────── 변경 ───────── */

  const change = (f: (s: Show) => Show) => {
    const next = f(show);
    if (next !== show) apply(() => next);
    return next;
  };

  const moveTo = (r: number, c: number, extend = false) => {
    const p = { r: clampR(r), c: Math.max(0, Math.min(LAST, c)) };
    setActive(p);
    if (!extend) setAnchor(p);
    wantFocus.current = true;
  };

  const focusGrid = () => {
    wantFocus.current = true;
    inputRef.current?.focus({ preventScroll: true });
  };

  useImperativeHandle(handle, () => ({
    focus(where) {
      // 위 표에서 ↓로 오면 맨 윗행, 아래 표에서 ↑로 오면 맨 아래(새 항목) 행
      moveTo(where === "top" ? 0 : n, a.c);
      wantFocus.current = true;
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    },
  }));

  const setCell = (s: Show, r: number, col: SheetColumn<T>, text: string): Show | null => {
    let x = s;
    if (r >= ops.count(x)) {
      if (text.trim() === "") return x;
      x = ops.append(x);
      r = ops.count(x) - 1;
    }
    return col.set(x, r, text);
  };

  const commit = (text: string, fill: boolean) => {
    if (!editRef.current) return;
    const col = columns[a.c];
    const target = fill && selRows.length > 1 ? selRows : [a.r];
    let bad = false;
    change((s) =>
      target.reduce((x, r) => {
        const nx = setCell(x, r, col, text);
        if (!nx) bad = true;
        return nx ?? x;
      }, s),
    );
    if (bad) onMessage(`${col.label}: "${text}"은(는) 인식할 수 없는 값입니다.`);
    setEdit(null);
  };

  const setToggle = (value: boolean) => {
    const col = columns[a.c];
    if (!col.toggle) return;
    const t = col.toggle;
    const target = selRows.length ? selRows : [a.r];
    change((s) => target.reduce((x, r) => setCell(x, r, col, value ? t.on : t.off) ?? x, s));
  };

  const toggleSelection = () => {
    const col = columns[a.c];
    const first = rows[selRows[0] ?? a.r];
    if (!col.toggle) return;
    setToggle(first ? !col.toggle.value(first) : true);
  };

  const clearSelection = () => {
    change((s) =>
      selRows.reduce(
        (x, r) =>
          range(sel.c0, sel.c1).reduce((y, c) => {
            const col = columns[c];
            return col.noClear || col.toggle ? y : (col.set(y, r, "") ?? y);
          }, x),
        s,
      ),
    );
  };

  const selectionTsv = () =>
    toTsv(selRows.map((r) => range(sel.c0, sel.c1).map((c) => columns[c].text(show, rows[r]))));

  const paste = (text: string) => {
    const cells = parseTsv(text);
    if (cells.length === 1 && cells[0].length === 1 && (selRows.length > 1 || sel.c0 !== sel.c1)) {
      change((s) =>
        selRows.reduce((x, r) => range(sel.c0, sel.c1).reduce((y, c) => columns[c].set(y, r, cells[0][0]) ?? y, x), s),
      );
      return;
    }
    const res = sheetPaste(show, columns, ops, a.r, a.c, text);
    if (res.rowCount === 0) return;
    change(() => res.show);
    const details: string[] = [];
    if (res.headerMap)
      details.push("헤더 인식: " + res.headerMap.map((h) => `${h.from || "(빈칸)"}→${h.to ?? "무시"}`).join(", "));
    details.push(...res.skipped.map((s) => `인식 못 해 건너뜀 — ${s}`));
    onMessage(`${label}: ${res.rowCount}행을 붙여넣었습니다.`, details.length ? details : undefined);
  };

  /* ───────── 행 조작 ───────── */

  const rowOps = {
    insert: () => {
      const at = Math.min(a.r, n - 1);
      change((s) => ops.insertAfter(s, at, renumber));
      moveTo(at + 1, a.c);
    },
    duplicate: () => {
      if (!selRows.length) return;
      const [f, t] = [selRows[0], selRows[selRows.length - 1]];
      change((s) => ops.duplicate(s, f, t, renumber));
      setAnchor({ r: t + 1, c: sel.c0 });
      setActive({ r: t + 1 + (t - f), c: sel.c1 });
    },
    remove: () => {
      if (!selRows.length) return;
      const [f, t] = [selRows[0], selRows[selRows.length - 1]];
      change((s) => ops.remove(s, f, t, renumber));
      moveTo(f, a.c);
    },
    move: (from: number, to: number, before: number) => {
      const res = ops.move(show, from, to, before, renumber);
      if (res.show !== show) apply(() => res.show);
      setAnchor({ r: res.start, c: sel.c0 });
      setActive({ r: res.start + (to - from), c: sel.c1 });
    },
  };

  /* ───────── 키보드 ───────── */

  const suggestions = (() => {
    const col = columns[a.c];
    if (!edit || !col.suggestions) return [];
    const q = edit.text.trim().toLowerCase();
    return col
      .suggestions(show)
      .filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      .slice(0, 8);
  })();

  const nextAfterTab = (back: boolean) => {
    if (tabStart === null) setTabStart(a.c);
    if (back) {
      if (a.c > 0) moveTo(a.r, a.c - 1);
      else if (a.r > 0) moveTo(a.r - 1, LAST);
    } else if (a.c < LAST) moveTo(a.r, a.c + 1);
    else moveTo(a.r + 1, tabStart ?? firstText);
  };

  const downAfterEnter = (up: boolean) => {
    moveTo(a.r + (up ? -1 : 1), tabStart ?? a.c);
    setTabStart(null);
  };

  const vertical = (dr: number, extend: boolean) => {
    if (!extend && onExit && ((dr > 0 && a.r === rowCount - 1) || (dr < 0 && a.r === 0))) {
      wantFocus.current = false;
      onExit(dr > 0 ? 1 : -1);
      return;
    }
    moveTo(a.r + dr, a.c, extend);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    const col = columns[a.c];
    const handled = () => e.preventDefault();

    if (edit) {
      const pick = edit.sug >= 0 ? suggestions[edit.sug] : undefined;
      switch (e.key) {
        case "Enter":
          handled();
          commit(pick ?? edit.text, mod);
          if (!mod) downAfterEnter(e.shiftKey);
          return;
        case "Tab":
          handled();
          commit(pick ?? edit.text, false);
          nextAfterTab(e.shiftKey);
          return;
        case "Escape":
          handled();
          setEdit(null);
          return;
        case "ArrowDown":
        case "ArrowUp":
          if (suggestions.length) {
            handled();
            const d = e.key === "ArrowDown" ? 1 : -1;
            setEdit({ ...edit, sug: Math.max(-1, Math.min(suggestions.length - 1, edit.sug + d)) });
          } else if (edit.mode === "enter") {
            handled();
            commit(edit.text, false);
            moveTo(a.r + (e.key === "ArrowDown" ? 1 : -1), a.c);
            setTabStart(null);
          }
          return;
        case "ArrowLeft":
        case "ArrowRight":
          if (edit.mode === "enter") {
            handled();
            commit(edit.text, false);
            moveTo(a.r, a.c + (e.key === "ArrowRight" ? 1 : -1));
            setTabStart(null);
          }
          return;
      }
      return;
    }

    if (e.altKey && !mod) {
      const opsByCode: Record<string, () => void> = {
        KeyN: rowOps.insert,
        KeyD: rowOps.duplicate,
        Backspace: rowOps.remove,
        Delete: rowOps.remove,
        ArrowUp: () => selRows.length && sel.r0 > 0 && rowOps.move(sel.r0, dataR1, sel.r0 - 1),
        ArrowDown: () => selRows.length && dataR1 < n - 1 && rowOps.move(sel.r0, dataR1, dataR1 + 2),
      };
      const op = opsByCode[e.code];
      if (op) {
        handled();
        op();
      }
      return;
    }

    if (mod) {
      const k = e.key.toLowerCase();
      const run = (f: () => void) => {
        handled();
        f();
      };
      if (k === "z" && !e.shiftKey) run(undo);
      else if ((k === "z" && e.shiftKey) || k === "y") run(redo);
      else if (k === "a")
        run(() => {
          setAnchor({ r: 0, c: 0 });
          setActive({ r: Math.max(0, n - 1), c: LAST });
        });
      else if (e.key === "ArrowUp") run(() => moveTo(0, a.c, e.shiftKey));
      else if (e.key === "ArrowDown") run(() => moveTo(rowCount - 1, a.c, e.shiftKey));
      else if (e.key === "ArrowLeft") run(() => moveTo(a.r, 0, e.shiftKey));
      else if (e.key === "ArrowRight") run(() => moveTo(a.r, LAST, e.shiftKey));
      else if (k === "c" || k === "x")
        run(() => {
          navigator.clipboard.writeText(selectionTsv()).catch(() => onMessage("클립보드에 복사하지 못했습니다."));
          if (k === "x") clearSelection();
        });
      return;
    }

    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
        handled();
        vertical(e.key === "ArrowUp" ? -1 : 1, e.shiftKey);
        setTabStart(null);
        return;
      case "ArrowLeft":
      case "ArrowRight":
        handled();
        moveTo(a.r, a.c + (e.key === "ArrowLeft" ? -1 : 1), e.shiftKey);
        setTabStart(null);
        return;
      case "Tab":
        handled();
        nextAfterTab(e.shiftKey);
        return;
      case "Home":
        handled();
        moveTo(a.r, 0, e.shiftKey);
        return;
      case "End":
        handled();
        moveTo(a.r, LAST, e.shiftKey);
        return;
      case "Enter":
      case "F2":
        handled();
        if (e.key === "Enter" && tabStart !== null) downAfterEnter(e.shiftKey);
        else if (col.toggle) toggleSelection();
        else {
          const row = rows[a.r];
          setEdit({ mode: "edit", text: row ? (col.editText ?? col.text)(show, row) : "", sug: -1 });
        }
        return;
      case " ":
        if (e.shiftKey) {
          handled();
          setAnchor({ r: a.r, c: 0 });
          setActive({ r: a.r, c: LAST });
        } else if (col.pick && onPick) {
          handled();
          openPick(a.r, col.key);
        } else if (col.toggle) {
          handled();
          toggleSelection();
        }
        return;
      case "Delete":
      case "Backspace":
        handled();
        clearSelection();
        return;
      case "Escape":
        handled();
        if (sel.r0 !== sel.r1 || sel.c0 !== sel.c1) moveTo(a.r, a.c);
        else {
          wantFocus.current = false;
          inputRef.current?.blur();
        }
        return;
    }
  };

  const onInputChange = (value: string) => {
    if (edit) return setEdit({ ...edit, text: value, sug: -1 });
    const col = columns[a.c];
    if (col.toggle) {
      // 체크형 열에서 바로 친 글자: 열이 알아듣는 값(s/m, p 등)이면 그대로 적용
      const v = value.trim();
      const target = selRows.length ? selRows : [a.r];
      if (v) change((s) => target.reduce((x, r) => setCell(x, r, col, v) ?? x, s));
      return;
    }
    setEdit({ mode: "enter", text: value, sug: -1 });
  };

  const openPick = (r: number, colKey: string) => {
    if (editRef.current) commit(editRef.current.text, false);
    // 빈 행이면 선택 창이 고를 때 새 항목을 만든다
    moveTo(r, a.c);
    wantFocus.current = false;
    onPick?.(r, colKey);
  };

  /* ───────── 렌더 ───────── */

  const cellIssue = useMemo(() => issues ?? new Map<string, string>(), [issues]);

  return (
    <div className="overflow-x-auto rounded border border-neutral-300 dark:border-neutral-700" aria-label={label}>
      <table className="w-full border-collapse text-sm select-none">
        <thead className="bg-neutral-100 dark:bg-neutral-900">
          <tr>
            {columns.map((col, c) => (
              <th
                key={col.key}
                className={`border-l border-neutral-200 px-2 py-1.5 text-left font-medium whitespace-nowrap text-neutral-600 first:border-l-0 dark:border-neutral-800 dark:text-neutral-400 ${col.width ?? ""} ${
                  focused && c >= sel.c0 && c <= sel.c1 ? "bg-blue-100 dark:bg-blue-950" : ""
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {range(0, rowCount - 1).map((r) => {
            const row = rows[r];
            const rowSel = r >= sel.r0 && r <= sel.r1;
            return (
              <tr key={row ? rowKey(row) : "new"} className={`border-t border-neutral-200 dark:border-neutral-800 ${!row ? "bg-neutral-50/50 dark:bg-neutral-900/30" : ""}`}>
                {columns.map((col, c) => {
                  const isActive = r === a.r && c === a.c;
                  const inSel = focused && rowSel && c >= sel.c0 && c <= sel.c1;
                  const issue = cellIssue.get(`${r}:${col.key}`);
                  return (
                    <td
                      key={col.key}
                      ref={isActive ? activeCellRef : undefined}
                      title={issue ?? (col.pick ? "눌러서 선택" : undefined)}
                      aria-selected={inSel}
                      data-active={(focused && isActive) || undefined}
                      onMouseDown={(e) => {
                        if (isActive && editRef.current) return;
                        e.preventDefault();
                        if (col.pick && onPick && !e.shiftKey) return openPick(r, col.key);
                        if (editRef.current) commit(editRef.current.text, false);
                        moveTo(r, c, e.shiftKey);
                        setTabStart(null);
                        focusGrid();
                      }}
                      onDoubleClick={() => {
                        if (col.toggle) return toggleSelection();
                        setEdit({ mode: "edit", text: row ? (col.editText ?? col.text)(show, row) : "", sug: -1 });
                      }}
                      className={`relative h-8 border-l border-neutral-200 px-2 whitespace-nowrap first:border-l-0 dark:border-neutral-800 ${
                        col.pick ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/40" : ""
                      } ${inSel ? "bg-blue-50 dark:bg-blue-950/60" : ""} ${
                        issue ? "bg-red-50 outline outline-1 -outline-offset-1 outline-red-500 dark:bg-red-950/60" : ""
                      } ${focused && isActive ? "outline outline-2 -outline-offset-2 outline-blue-600" : ""}`}
                    >
                      {row ? (col.render ? col.render(show, row) : col.text(show, row)) : c === 0 ? <span className="text-neutral-400">+</span> : null}
                      {isActive && (
                        <>
                          <input
                            ref={inputRef}
                            value={edit ? edit.text : ""}
                            onChange={(e) => onInputChange(e.target.value)}
                            onKeyDown={onKeyDown}
                            onFocus={() => setFocused(true)}
                            onBlur={() => {
                              setFocused(false);
                              if (editRef.current) commit(editRef.current.text, false);
                            }}
                            onPaste={(e) => {
                              const text = e.clipboardData.getData("text/plain");
                              if (edit && !/[\t\n]/.test(text.trimEnd())) return;
                              e.preventDefault();
                              setEdit(null);
                              paste(text);
                            }}
                            aria-label={`${label} ${col.label} ${row ? `${r + 1}행` : "새 행"}`}
                            autoComplete="off"
                            spellCheck={false}
                            className={`absolute inset-0 h-full w-full min-w-full px-2 outline-none select-text ${
                              edit ? "z-10 min-w-48 bg-white shadow-lg ring-2 ring-blue-600 dark:bg-neutral-900" : "cursor-default opacity-0"
                            }`}
                          />
                          {edit && suggestions.length > 0 && (
                            <ul className="absolute top-full left-0 z-20 mt-0.5 min-w-48 rounded border border-neutral-300 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                              {suggestions.map((s, i) => (
                                <li
                                  key={s}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    commit(s, false);
                                    focusGrid();
                                  }}
                                  className={`cursor-pointer px-2 py-0.5 ${i === edit.sug ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                                >
                                  {s}
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
