"use client";

/**
 * 인풋리스트 스프레드시트 그리드.
 *
 * 포커스 모델: 활성 셀 안에 늘 <input> 하나가 있고 포커스를 갖는다.
 * 탐색 상태에서는 투명하게 숨어 있다가, 글자를 치면 그대로 편집 상태가 된다.
 * (한글 IME 조합이 첫 글자부터 깨지지 않게 하려면 실제 입력창이 키를 받아야 한다)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Show } from "@/model/schema";
import { COLUMNS, FIELD_TO_COL, type Column } from "@/model/inputColumns";
import {
  appendChannel,
  deleteRange,
  duplicateRange,
  insertAfter,
  moveRange,
  nextNumber,
  updateChannel,
} from "@/model/inputOps";
import { applyPaste, parseTsv, toTsv } from "@/model/inputPaste";
import { resolvePhantom, SHORT_NAME_WARN_LENGTH } from "@/model/derive";
import { COLOR_LABEL, COLOR_SWATCH } from "@/model/labels";
import type { Color, InputChannel } from "@/model/schema";
import type { ValidationIssue } from "./useShowDoc";

type Pos = { r: number; c: number };
type Edit = { mode: "enter" | "edit"; text: string; sug: number };

const LAST_COL = COLUMNS.length - 1;
const COL_WIDTH: Record<string, string> = {
  ch: "w-12",
  source: "min-w-36",
  shortName: "w-24",
  mic: "min-w-36",
  stand: "w-24",
  phantom: "w-12",
  port: "w-32",
  link: "w-14",
  color: "w-20",
  dca: "w-24",
  notes: "min-w-40",
};

interface Props {
  show: Show;
  apply: (fn: (s: Show) => Show) => void;
  undo: () => void;
  redo: () => void;
  issues: ValidationIssue[];
  renumber: boolean;
  onMessage: (text: string, details?: string[]) => void;
}

export default function InputGrid({ show, apply, undo, redo, issues, renumber, onMessage }: Props) {
  const n = show.inputs.length;
  const rowCount = n + 1; // 마지막은 새 채널 입력용 빈 행
  const [active, setActive] = useState<Pos>({ r: 0, c: 1 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 1 });
  const [edit, setEditState] = useState<Edit | null>(null);
  // blur 등 늦게 도착하는 이벤트가 이미 끝난 편집을 다시 커밋하지 않도록 동기 참조를 둔다
  const editRef = useRef<Edit | null>(null);
  const setEdit = (e: Edit | null) => {
    editRef.current = e;
    setEditState(e);
  };
  const [tabStart, setTabStart] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const dragBlock = useRef<[number, number] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCellRef = useRef<HTMLTableCellElement>(null);
  const wantFocus = useRef(true);

  // 행이 줄어들면(삭제·실행 취소) 선택을 범위 안으로
  const clampR = (r: number) => Math.max(0, Math.min(rowCount - 1, r));
  const a = { r: clampR(active.r), c: active.c };
  const b = { r: clampR(anchor.r), c: anchor.c };
  const sel = {
    r0: Math.min(a.r, b.r),
    r1: Math.max(a.r, b.r),
    c0: Math.min(a.c, b.c),
    c1: Math.max(a.c, b.c),
  };
  const dataR1 = Math.min(sel.r1, n - 1);
  const selRows = sel.r0 <= dataR1 ? range(sel.r0, dataR1) : [];

  useEffect(() => {
    if (!wantFocus.current) return;
    inputRef.current?.focus({ preventScroll: true });
    activeCellRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [a.r, a.c, n]);

  const cellIssues = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues) {
      if (i.path[0] !== "inputs" || typeof i.path[1] !== "number") continue;
      const col = FIELD_TO_COL[i.path[2] as keyof InputChannel];
      if (col) m.set(`${i.path[1]}:${col}`, i.message);
    }
    return m;
  }, [issues]);

  /* ───────── 상태 변경 도우미 ───────── */

  /** 현재 show에서 다음 show를 계산해 히스토리에 넣는다 */
  const change = (f: (s: Show) => Show) => {
    const next = f(show);
    if (next !== show) apply(() => next);
    return next;
  };

  const moveTo = (r: number, c: number, extend = false) => {
    const p = { r: clampR(r), c: Math.max(0, Math.min(LAST_COL, c)) };
    setActive(p);
    if (!extend) setAnchor(p);
    wantFocus.current = true;
  };

  const focusGrid = () => {
    wantFocus.current = true;
    inputRef.current?.focus({ preventScroll: true });
  };

  /** 한 셀에 텍스트 적용 (빈 행이면 채널 생성). 인식 실패 시 null */
  const setCell = (s: Show, r: number, col: Column, text: string): Show | null => {
    let x = s;
    if (r >= x.inputs.length) {
      if (text.trim() === "") return x;
      x = appendChannel(x);
      r = x.inputs.length - 1;
    }
    return col.set(x, r, text);
  };

  const commit = (text: string, fill: boolean) => {
    if (!editRef.current) return;
    const col = COLUMNS[a.c];
    const rows = fill && selRows.length > 1 ? selRows : [a.r];
    let bad = false;
    change((s) =>
      rows.reduce((x, r) => {
        const nx = setCell(x, r, col, text);
        if (!nx) bad = true;
        return nx ?? x;
      }, s),
    );
    if (bad) onMessage(`${col.label}: "${text}"은(는) 인식할 수 없는 값입니다.`);
    setEdit(null);
  };

  const setToggle = (value: boolean) => {
    const col = COLUMNS[a.c];
    const rows = selRows.length ? selRows : [a.r];
    change((s) => rows.reduce((x, r) => setCell(x, r, col, value ? "on" : "off") ?? x, s));
  };

  const toggleSelection = () => {
    const col = COLUMNS[a.c];
    const first = show.inputs[selRows[0] ?? a.r];
    const current = first
      ? col.key === "phantom"
        ? resolvePhantom(show, first)
        : first.stereoLinkNext
      : false;
    setToggle(!current);
  };

  const clearSelection = () => {
    change((s) =>
      selRows.reduce(
        (x, r) =>
          range(sel.c0, sel.c1).reduce((y, c) => {
            const col = COLUMNS[c];
            return col.key === "ch" ? y : (col.set(y, r, "") ?? y);
          }, x),
        s,
      ),
    );
  };

  const selectionTsv = () =>
    toTsv(selRows.map((r) => range(sel.c0, sel.c1).map((c) => COLUMNS[c].text(show, show.inputs[r]))));

  const paste = (text: string) => {
    const cells = parseTsv(text);
    if (cells.length === 1 && cells[0].length === 1 && (selRows.length > 1 || sel.c0 !== sel.c1)) {
      // 값 하나를 여러 셀에 붙여넣기 → 선택 범위 채우기
      change((s) =>
        selRows.reduce(
          (x, r) => range(sel.c0, sel.c1).reduce((y, c) => COLUMNS[c].set(y, r, cells[0][0]) ?? y, x),
          s,
        ),
      );
      return;
    }
    const res = applyPaste(show, a.r, a.c, text);
    if (res.rowCount === 0) return;
    change(() => res.show);
    const details: string[] = [];
    if (res.headerMap)
      details.push(
        "헤더 인식: " +
          res.headerMap.map((h) => `${h.from || "(빈칸)"}→${h.to ?? "무시"}`).join(", "),
      );
    details.push(...res.skipped.map((s) => `인식 못 해 건너뜀 — ${s}`));
    onMessage(`${res.rowCount}행을 붙여넣었습니다.`, details.length ? details : undefined);
    const width = res.headerMap ? LAST_COL : Math.max(0, (cells[0]?.length ?? 1) - 1);
    setAnchor({ r: a.r, c: res.headerMap ? 0 : a.c });
    setActive({ r: a.r + res.rowCount - 1, c: res.headerMap ? width : Math.min(LAST_COL, a.c + width) });
  };

  /* ───────── 행 조작 ───────── */

  const rowOps = {
    insert: () => {
      const at = Math.min(a.r, n - 1);
      change((s) => insertAfter(s, at, renumber));
      moveTo(at + 1, a.c);
    },
    duplicate: () => {
      if (!selRows.length) return;
      const [f, t] = [selRows[0], selRows[selRows.length - 1]];
      change((s) => duplicateRange(s, f, t, renumber));
      setAnchor({ r: t + 1, c: sel.c0 });
      setActive({ r: t + 1 + (t - f), c: sel.c1 });
    },
    remove: () => {
      if (!selRows.length) return;
      const [f, t] = [selRows[0], selRows[selRows.length - 1]];
      change((s) => deleteRange(s, f, t, renumber));
      moveTo(f, a.c);
    },
    move: (from: number, to: number, insertBefore: number) => {
      const res = moveRange(show, from, to, insertBefore, renumber);
      if (res.show !== show) apply(() => res.show);
      setAnchor({ r: res.start, c: sel.c0 });
      setActive({ r: res.start + (to - from), c: sel.c1 });
    },
  };

  /* ───────── 키보드 ───────── */

  const suggestions = (() => {
    const col = COLUMNS[a.c];
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
      else if (a.r > 0) moveTo(a.r - 1, LAST_COL);
    } else if (a.c < LAST_COL) moveTo(a.r, a.c + 1);
    else moveTo(a.r + 1, tabStart ?? 1);
  };

  const downAfterEnter = (up: boolean) => {
    moveTo(a.r + (up ? -1 : 1), tabStart ?? a.c);
    setTabStart(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    const col = COLUMNS[a.c];
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

    // 행 조작 (Alt 조합 — macOS에서 Option+문자는 특수문자가 되므로 e.code로 판별)
    if (e.altKey && !mod) {
      const ops: Record<string, () => void> = {
        KeyN: rowOps.insert,
        KeyD: rowOps.duplicate,
        Backspace: rowOps.remove,
        Delete: rowOps.remove,
        ArrowUp: () => selRows.length && sel.r0 > 0 && rowOps.move(sel.r0, dataR1, sel.r0 - 1),
        ArrowDown: () => selRows.length && dataR1 < n - 1 && rowOps.move(sel.r0, dataR1, dataR1 + 2),
      };
      const op = ops[e.code];
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
          setActive({ r: Math.max(0, n - 1), c: LAST_COL });
        });
      else if (e.key === "ArrowUp") run(() => moveTo(0, a.c, e.shiftKey));
      else if (e.key === "ArrowDown") run(() => moveTo(rowCount - 1, a.c, e.shiftKey));
      else if (e.key === "ArrowLeft") run(() => moveTo(a.r, 0, e.shiftKey));
      else if (e.key === "ArrowRight") run(() => moveTo(a.r, LAST_COL, e.shiftKey));
      else if (k === "c" || k === "x")
        run(() => {
          // 빈 입력창에서는 copy 이벤트가 오지 않는 브라우저가 있어 클립보드 API로 직접 쓴다
          navigator.clipboard
            .writeText(selectionTsv())
            .catch(() => onMessage("클립보드에 복사하지 못했습니다."));
          if (k === "x") clearSelection();
        });
      return; // 붙여넣기는 onPaste에서
    }

    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        handled();
        const dr = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        const dc = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        moveTo(a.r + dr, a.c + dc, e.shiftKey);
        setTabStart(null);
        return;
      }
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
        moveTo(a.r, LAST_COL, e.shiftKey);
        return;
      case "Enter":
      case "F2":
        handled();
        // Tab으로 한 행을 입력하던 중이면(엑셀처럼) Enter는 다음 행의 시작 열로
        if (e.key === "Enter" && tabStart !== null) downAfterEnter(e.shiftKey);
        else if (col.toggle) toggleSelection();
        else {
          const ch = show.inputs[a.r];
          setEdit({ mode: "edit", text: ch ? col.editText(show, ch) : "", sug: -1 });
        }
        return;
      case " ":
        if (e.shiftKey) {
          handled();
          setAnchor({ r: a.r, c: 0 });
          setActive({ r: a.r, c: LAST_COL });
        } else if (col.toggle) {
          handled();
          toggleSelection();
        }
        return; // 일반 열의 스페이스는 입력으로 처리
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
    const col = COLUMNS[a.c];
    if (col.toggle) {
      const v = value.trim() ? parseToggleKey(value) : undefined;
      if (v !== undefined) setToggle(v);
      return;
    }
    setEdit({ mode: "enter", text: value, sug: -1 });
  };

  /* ───────── 일괄 변경 툴바 ───────── */

  const batch = (f: (s: Show, r: number) => Show) => {
    change((s) => selRows.reduce(f, s));
    focusGrid();
  };

  /* ───────── 렌더 ───────── */

  const dcaLabel = (id: string) => {
    const d = show.dcas.find((x) => x.id === id);
    return d ? (d.name ? `${d.number} ${d.name}` : String(d.number)) : "?";
  };

  const renderCell = (col: Column, ch: InputChannel | undefined) => {
    if (!ch) return col.key === "ch" ? <span className="text-neutral-400">{nextNumber(show.inputs)}</span> : null;
    switch (col.key) {
      case "ch":
        return <span className="tabular-nums">{ch.number}</span>;
      case "shortName":
        return (
          <span
            className={`font-mono ${ch.shortName.length > SHORT_NAME_WARN_LENGTH ? "text-amber-600" : ""}`}
            title={ch.shortName.length > SHORT_NAME_WARN_LENGTH ? `${SHORT_NAME_WARN_LENGTH}자 초과 — 콘솔에서 잘릴 수 있음` : undefined}
          >
            {ch.shortName}
          </span>
        );
      case "mic":
        return ch.mic?.kind === "custom" ? (
          <span className="italic" title="라이브러리에 없는 장비">{ch.mic.name}</span>
        ) : (
          col.text(show, ch)
        );
      case "stand":
        return <span className={ch.stand === null ? "text-neutral-400" : ""}>{col.text(show, ch)}</span>;
      case "phantom":
        return resolvePhantom(show, ch) ? (
          <span className={`text-red-600 ${ch.phantom === null ? "opacity-60" : "font-semibold"}`}>48V</span>
        ) : ch.phantom === false ? (
          <span className="text-neutral-400">off</span>
        ) : null;
      case "link":
        return ch.stereoLinkNext ? <span>↔ {ch.number + 1}</span> : null;
      case "color":
        return ch.color === "none" ? null : (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm border border-neutral-400" style={{ background: COLOR_SWATCH[ch.color] }} />
            {COLOR_LABEL[ch.color]}
          </span>
        );
      case "dca":
        return <span className="whitespace-nowrap">{ch.dcaIds.map(dcaLabel).join(", ")}</span>;
      default:
        return col.text(show, ch);
    }
  };

  const tool = "rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

  return (
    <div>
      {/* 툴바 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" onMouseDown={() => (wantFocus.current = false)}>
        <button className={tool} onClick={() => (rowOps.insert(), focusGrid())}>행 삽입 <kbd>⌥N</kbd></button>
        <button className={tool} onClick={() => (rowOps.duplicate(), focusGrid())}>복제 <kbd>⌥D</kbd></button>
        <button className={tool} onClick={() => (rowOps.remove(), focusGrid())}>삭제 <kbd>⌥⌫</kbd></button>
        <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" />
        <span className="text-neutral-500">
          선택 {selRows.length}행{selRows.length ? ` (Ch ${show.inputs[selRows[0]].number}–${show.inputs[selRows[selRows.length - 1]].number})` : ""}:
        </span>
        <select
          className={tool}
          value=""
          disabled={!selRows.length}
          onChange={(e) => batch((s, r) => updateChannel(s, r, { color: e.target.value as Color }))}
        >
          <option value="" disabled>컬러…</option>
          {(Object.keys(COLOR_LABEL) as Color[]).map((c) => (
            <option key={c} value={c}>{COLOR_LABEL[c]}</option>
          ))}
        </select>
        <select
          className={tool}
          value=""
          disabled={!selRows.length || !show.dcas.length}
          onChange={(e) =>
            batch((s, r) => {
              const ids = s.inputs[r].dcaIds;
              return ids.includes(e.target.value) ? s : updateChannel(s, r, { dcaIds: [...ids, e.target.value] });
            })
          }
        >
          <option value="" disabled>DCA 추가…</option>
          {show.dcas.map((d) => (
            <option key={d.id} value={d.id}>{dcaLabel(d.id)}</option>
          ))}
        </select>
        <select
          className={tool}
          value=""
          disabled={!selRows.length || !show.dcas.length}
          onChange={(e) =>
            batch((s, r) => {
              const ids = s.inputs[r].dcaIds;
              return ids.includes(e.target.value) ? updateChannel(s, r, { dcaIds: ids.filter((i) => i !== e.target.value) }) : s;
            })
          }
        >
          <option value="" disabled>DCA 해제…</option>
          {show.dcas.map((d) => (
            <option key={d.id} value={d.id}>{dcaLabel(d.id)}</option>
          ))}
        </select>
        <span className="text-neutral-500">48V</span>
        <button className={tool} disabled={!selRows.length} onClick={() => batch((s, r) => updateChannel(s, r, { phantom: true }))}>켜기</button>
        <button className={tool} disabled={!selRows.length} onClick={() => batch((s, r) => updateChannel(s, r, { phantom: false }))}>끄기</button>
        <button className={tool} disabled={!selRows.length} onClick={() => batch((s, r) => updateChannel(s, r, { phantom: null }))} title="마이크 기본값을 따름">기본값</button>
      </div>

      <div className="overflow-x-auto rounded border border-neutral-300 dark:border-neutral-700">
        <table className="w-full border-collapse text-sm select-none">
          <thead className="bg-neutral-100 dark:bg-neutral-900">
            <tr>
              <th className="w-5" />
              {COLUMNS.map((col, c) => (
                <th
                  key={col.key}
                  className={`border-l border-neutral-200 px-2 py-1.5 text-left font-medium whitespace-nowrap text-neutral-600 dark:border-neutral-800 dark:text-neutral-400 ${COL_WIDTH[col.key]} ${
                    c >= sel.c0 && c <= sel.c1 ? "bg-blue-100 dark:bg-blue-950" : ""
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {range(0, rowCount - 1).map((r) => {
              const ch = show.inputs[r];
              const rowSelected = r >= sel.r0 && r <= sel.r1;
              return (
                <tr
                  key={ch?.id ?? "new"}
                  onDragOver={(e) => {
                    if (!dragBlock.current) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDrop(ch && e.clientY > rect.top + rect.height / 2 ? r + 1 : r);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragBlock.current && drop !== null) rowOps.move(dragBlock.current[0], dragBlock.current[1], drop);
                    dragBlock.current = null;
                    setDrop(null);
                    focusGrid();
                  }}
                  className={`border-t border-neutral-200 dark:border-neutral-800 ${
                    drop === r ? "shadow-[inset_0_2px_0_0_#3b82f6]" : drop === r + 1 && r === rowCount - 1 ? "shadow-[inset_0_-2px_0_0_#3b82f6]" : ""
                  } ${!ch ? "bg-neutral-50/50 dark:bg-neutral-900/30" : ""}`}
                >
                  <td
                    draggable={!!ch}
                    onDragStart={(e) => {
                      dragBlock.current = rowSelected && selRows.includes(r) ? [selRows[0], selRows[selRows.length - 1]] : [r, r];
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      dragBlock.current = null;
                      setDrop(null);
                    }}
                    onMouseDown={(e) => {
                      if (!ch) return;
                      wantFocus.current = true;
                      if (e.shiftKey) setActive({ r, c: LAST_COL });
                      else {
                        setAnchor({ r, c: 0 });
                        setActive({ r, c: LAST_COL });
                      }
                      // 드래그 시작을 막지 않도록 preventDefault 대신 다음 프레임에 포커스
                      requestAnimationFrame(focusGrid);
                    }}
                    className={`text-center text-neutral-400 ${ch ? "cursor-grab" : ""}`}
                    title={ch ? "드래그해서 순서 변경 · 클릭해서 행 선택" : undefined}
                  >
                    {ch ? "⠿" : ""}
                  </td>
                  {COLUMNS.map((col, c) => {
                    const isActive = r === a.r && c === a.c;
                    const inSel = rowSelected && c >= sel.c0 && c <= sel.c1;
                    const issue = cellIssues.get(`${r}:${col.key}`);
                    return (
                      <td
                        key={col.key}
                        ref={isActive ? activeCellRef : undefined}
                        title={issue}
                        aria-selected={inSel}
                        data-active={isActive || undefined}
                        onMouseDown={(e) => {
                          if (isActive && editRef.current) return; // 편집 중인 입력창 안 클릭(커서 이동)
                          e.preventDefault(); // 브라우저가 포커스를 body로 옮기지 않게
                          if (editRef.current) commit(editRef.current.text, false);
                          moveTo(r, c, e.shiftKey);
                          setTabStart(null);
                          focusGrid();
                        }}
                        onDoubleClick={() => {
                          if (col.toggle) return toggleSelection();
                          setEdit({ mode: "edit", text: ch ? col.editText(show, ch) : "", sug: -1 });
                        }}
                        className={`relative h-8 border-l border-neutral-200 px-2 whitespace-nowrap dark:border-neutral-800 ${
                          inSel ? "bg-blue-50 dark:bg-blue-950/60" : ""
                        } ${issue ? "bg-red-50 outline outline-1 -outline-offset-1 outline-red-500 dark:bg-red-950/60" : ""} ${
                          isActive ? "outline outline-2 -outline-offset-2 outline-blue-600" : ""
                        }`}
                      >
                        {renderCell(col, ch)}
                        {isActive && (
                          <>
                            <input
                              ref={inputRef}
                              value={edit ? edit.text : ""}
                              onChange={(e) => onInputChange(e.target.value)}
                              onKeyDown={onKeyDown}
                              onBlur={() => {
                                if (editRef.current) commit(editRef.current.text, false);
                              }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text/plain");
                                if (edit && !/[\t\n]/.test(text.trimEnd())) return;
                                e.preventDefault();
                                setEdit(null);
                                paste(text);
                              }}
                              aria-label={`${col.label} ${ch ? `Ch ${ch.number}` : "새 채널"}`}
                              autoComplete="off"
                              spellCheck={false}
                              className={`absolute inset-0 h-full w-full min-w-full px-2 outline-none select-text ${
                                edit
                                  ? "z-10 min-w-48 bg-white shadow-lg ring-2 ring-blue-600 dark:bg-neutral-900"
                                  : "cursor-default opacity-0"
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
    </div>
  );
}

/** 체크형 열에서 바로 친 글자: y/1/o → 켜기, n/0/x → 끄기 */
function parseToggleKey(value: string): boolean | undefined {
  const k = value.trim().toLowerCase();
  if (/^[y1o4v]$/.test(k)) return true;
  if (/^[n0x\-]$/.test(k)) return false;
  return undefined;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
