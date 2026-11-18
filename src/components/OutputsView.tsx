"use client";

/** 아웃풋 입력: Aux/Mix, Matrix, Main 표 + 버스 번호를 누르면 용도별 이름 목록 */
import { useMemo, useRef, useState } from "react";
import type { BusKind, Show } from "@/model/schema";
import { BUS_PURPOSE_LABEL } from "@/model/labels";
import { busAccess, busesOf, rowOps } from "@/model/outputOps";
import { busColumns, busIssueCell } from "@/model/outputColumns";
import { applyPreset, BUS_PRESETS, presetName, suggestNextPresets, type BusPreset } from "@/model/busPresets";
import { norm } from "@/model/text";
import Sheet, { type SheetHandle } from "./Sheet";
import ChoiceSheet, { type ChoiceItem, type ChoiceSection } from "./ChoiceSheet";
import type { ValidationIssue } from "./useShowDoc";

const KINDS: { kind: BusKind; title: string; help: string }[] = [
  { kind: "aux", title: "Aux / Mix", help: "모니터·IEM·FX 센드. 번호를 누르면 용도별 이름 목록이 뜹니다." },
  { kind: "matrix", title: "Matrix", help: "딜레이·필·로비·녹음·중계. 소스 열에 받는 버스를 적습니다 (예: Main L/R, Aux 9)." },
  { kind: "main", title: "Main", help: "메인 출력 패치 (L/R, Mono/Sub)." },
];

interface Props {
  show: Show;
  apply: (fn: (s: Show) => Show) => void;
  undo: () => void;
  redo: () => void;
  renumber: boolean;
  issues: ValidationIssue[];
  onMessage: (text: string, details?: string[]) => void;
  focusRequest?: { kind: BusKind; row: number; col: string; n: number } | null;
}

export default function OutputsView({ show, apply, undo, redo, renumber, issues, onMessage, focusRequest }: Props) {
  const [picker, setPicker] = useState<{ kind: BusKind; row: number } | null>(null);
  const handles = useRef<Record<BusKind, SheetHandle | null>>({ aux: null, matrix: null, main: null });

  const issueMaps = useMemo(() => {
    const maps: Record<BusKind, Map<string, string>> = { aux: new Map(), matrix: new Map(), main: new Map() };
    for (const i of issues) {
      const cell = busIssueCell(show, i.path);
      if (cell) maps[cell.kind].set(`${cell.row}:${cell.col}`, i.message);
    }
    return maps;
  }, [issues, show]);

  return (
    <div className="space-y-8">
      {KINDS.map(({ kind, title, help }, k) => {
        const rows = busesOf(show, kind);
        return (
          <section key={kind}>
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <h2 className="text-base font-semibold">
                {title} <span className="text-sm font-normal text-neutral-500">({rows.length})</span>
              </h2>
              <p className="text-xs text-neutral-500">{help}</p>
              <button
                className="ml-auto rounded border border-blue-500 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-neutral-100 dark:text-blue-300 dark:hover:bg-neutral-800"
                onClick={() => setPicker({ kind, row: rows.length })}
              >
                누르기 입력 ▸
              </button>
            </div>
            <Sheet
              label={title}
              show={show}
              rows={rows}
              rowKey={(b) => b.id}
              columns={busColumns(kind)}
              ops={rowOps(busAccess(kind))}
              apply={apply}
              undo={undo}
              redo={redo}
              renumber={renumber}
              issues={issueMaps[kind]}
              onMessage={onMessage}
              onPick={(row) => setPicker({ kind, row })}
              onExit={(dir) => {
                const next = KINDS[k + dir];
                if (next) handles.current[next.kind]?.focus(dir > 0 ? "top" : "bottom");
              }}
              handle={(h) => {
                handles.current[kind] = h;
              }}
              autoFocus={k === 0}
              paused={picker !== null}
              focusRequest={focusRequest?.kind === kind ? focusRequest : null}
              activeRow={picker?.kind === kind ? picker.row : null}
            />
          </section>
        );
      })}

      {picker && (
        <BusPicker
          show={show}
          kind={picker.kind}
          row={picker.row}
          apply={apply}
          onRow={(row) => setPicker({ ...picker, row })}
          onClose={() => {
            const k = picker.kind;
            setPicker(null);
            requestAnimationFrame(() => handles.current[k]?.focus("top"));
          }}
        />
      )}
    </div>
  );
}

/** 버스 번호를 누르면 뜨는 이름 목록. 고르면 이름·용도·M/S·Pre/Post가 채워지고 다음 행으로. */
function BusPicker({
  show,
  kind,
  row,
  apply,
  onRow,
  onClose,
}: {
  show: Show;
  kind: BusKind;
  row: number;
  apply: (fn: (s: Show) => Show) => void;
  onRow: (row: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ops = rowOps(busAccess(kind));
  const q = norm(query);
  const bus = busesOf(show, kind)[row];
  const kindLabel = kind === "aux" ? "Aux" : kind === "matrix" ? "Matrix" : "Main";

  const choose = (p: BusPreset | { name: string }) => {
    apply((s) => {
      let x = s;
      while (ops.count(x) <= row) x = ops.append(x);
      return applyPreset(x, kind, row, p);
    });
    setQuery("");
    onRow(row + 1);
  };

  const item = (p: BusPreset, prefix = ""): ChoiceItem => ({
    key: prefix + p.id,
    label: presetName(show, kind, p, row),
    sub: [
      BUS_PURPOSE_LABEL[p.purpose],
      p.width === "stereo" ? "Stereo" : "Mono",
      kind === "aux" && p.tap ? (p.tap === "pre" ? "Pre" : "Post") : "",
    ]
      .filter(Boolean)
      .join(" · "),
    run: () => choose(p),
  });

  const sections: ChoiceSection[] = [];
  if (!q) {
    const next = suggestNextPresets(show, kind, row);
    if (next.length) sections.push({ title: "다음 추천", items: next.map((p) => item(p, "next-")) });
  }
  const groups = [...new Set(BUS_PRESETS[kind].map((p) => p.group))];
  for (const g of groups) {
    const items = BUS_PRESETS[kind]
      .filter((p) => p.group === g && (!q || norm(p.name).includes(q) || norm(BUS_PURPOSE_LABEL[p.purpose]).includes(q)))
      .map((p) => item(p));
    if (items.length) sections.push({ title: g, items });
  }
  if (q && !BUS_PRESETS[kind].some((p) => norm(p.name) === q))
    sections.push({ title: "직접 입력", items: [{ key: "typed", label: `“${query.trim()}” 입력`, sub: "이름만 넣습니다", run: () => choose({ name: query }) }] });

  const number = bus?.number ?? (busesOf(show, kind).reduce((m, b) => Math.max(m, b.number), 0) + 1);
  return (
    <ChoiceSheet
      title={`${kindLabel} ${number} · 이름${bus?.name ? ` (지금: ${bus.name})` : ""}`}
      query={query}
      setQuery={setQuery}
      placeholder="이름 검색 또는 직접 입력"
      sections={sections}
      onClose={onClose}
      resetKey={row}
      hint={<><kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 선택 후 다음 버스로 · <kbd>Esc</kbd> 닫기</>}
    />
  );
}
