"use client";

/**
 * 누르기만 해서 입력하는 흐름: 소스 선택 → 추천 마이크 선택 → 다음 채널.
 * 터치(큰 버튼, 아래에서 올라오는 시트)와 키보드(검색 입력, ↑↓, Enter, Esc) 모두 지원.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MicType, Show } from "@/model/schema";
import { MIC_TYPE_LABEL } from "@/model/labels";
import { COLOR_SWATCH } from "@/model/labels";
import { nextNumber } from "@/model/inputOps";
import { norm } from "@/model/text";
import {
  addMic,
  addSource,
  channelsOf,
  learnPick,
  micOptions,
  nextSourceNumber,
  sourceLabel,
  suggestNextSources,
  type Library,
  type MicOption,
  type SourceDef,
} from "@/model/library";
import {
  applyMicPick,
  applySourcePick,
  rowsForExisting,
  type MicChoice,
  type SourceChoice,
} from "@/model/pickFlow";

type Step =
  | { kind: "source"; row: number }
  | { kind: "mic"; rows: number[]; src: SourceDef | null; label: string };

type Prompt = { kind: "source" | "mic"; name: string } | null;

type Item = {
  key: string;
  label: string;
  sub?: string;
  badge?: { text: string; bad?: boolean };
  swatch?: string;
  run: () => void;
};
/** header가 있으면 접고 펴는 악기군 (header도 키보드 목록의 한 항목) */
type Section = { title: string; header?: Item; items: Item[]; compact?: boolean };

const RECENT_KEY = "onepatch.picker.recentGroups";
const OPEN_KEY = "onepatch.picker.openGroups";

function readList(key: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}
function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

interface Props {
  show: Show;
  library: Library;
  start: number;
  renumber: boolean;
  apply: (fn: (s: Show) => Show) => void;
  updateLibrary: (fn: (l: Library) => Library) => void;
  /** 흐름이 다른 행으로 옮겨갈 때 (그리드 선택을 따라가게) */
  onRow: (row: number) => void;
  onClose: (row: number) => void;
}

const MIC_TYPES: MicType[] = ["dynamic", "condenser", "ribbon", "di", "wireless"];

export default function PickFlow({ show, library, start, renumber, apply, updateLibrary, onRow, onClose }: Props) {
  const [step, setStep] = useState<Step>({ kind: "source", row: start });
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [prompt, setPrompt] = useState<Prompt>(null);
  /** 마이크 목록을 종류로 거르기 (null = 전체) */
  const [micType, setMicType] = useState<MicType | null>(null);
  /** 마지막으로 쓴 악기군 (앞일수록 최근) */
  const [recent, setRecent] = useState<string[]>(() => readList(RECENT_KEY) ?? []);
  /** 펼쳐 둔 악기군. 저장된 적이 없으면 맨 위 악기군만 펼친다. */
  const [open, setOpen] = useState<string[] | null>(() => readList(OPEN_KEY));
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const firstPromptBtn = useRef<HTMLButtonElement>(null);

  const row = step.kind === "source" ? step.row : step.rows[0];
  const touch = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
    [],
  );

  // 단계가 바뀌면 검색창으로 (터치 기기에서는 화면 키보드가 뜨지 않게 생략)
  useEffect(() => {
    if (prompt) firstPromptBtn.current?.focus();
    else if (!touch) searchRef.current?.focus();
  }, [step, prompt, touch]);

  useEffect(() => {
    listRef.current?.querySelector("[data-hi]")?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const reset = (next: Step) => {
    setStep(next);
    setQuery("");
    setHi(0);
    setPrompt(null);
  };

  const close = () => onClose(row);

  /* ───────── 동작 ───────── */

  const groupOrder = useMemo(() => {
    const ids = new Set(library.groups.map((g) => g.id));
    const first = recent.filter((id) => ids.has(id));
    return [
      ...first.map((id) => library.groups.find((g) => g.id === id)!),
      ...library.groups.filter((g) => !first.includes(g.id)),
    ];
  }, [library.groups, recent]);
  const openSet = new Set(open ?? groupOrder.slice(0, 1).map((g) => g.id));

  const toggleGroup = (id: string) => {
    const next = openSet.has(id) ? [...openSet].filter((x) => x !== id) : [...openSet, id];
    setOpen(next);
    writeList(OPEN_KEY, next);
  };

  /** 고른 소스의 악기군을 맨 위로, 펼친 상태로 */
  const markGroupUsed = (groupId: string) => {
    const r = [groupId, ...recent.filter((x) => x !== groupId)].slice(0, 20);
    setRecent(r);
    writeList(RECENT_KEY, r);
    if (!openSet.has(groupId)) {
      const o = [...openSet, groupId];
      setOpen(o);
      writeList(OPEN_KEY, o);
    }
  };

  const pickSource = (choice: SourceChoice, lib = library) => {
    if (choice.kind === "library") markGroupUsed(choice.src.groupId);
    const r = applySourcePick(show, lib, row, choice, renumber);
    apply(() => r.show);
    const src = choice.kind === "library" ? choice.src : null;
    onRow(r.rows[0]);
    reset({ kind: "mic", rows: r.rows, src, label: src ? sourceLabel(src) : choice.kind === "text" ? choice.name : "" });
  };

  const keepSource = () => {
    const r = rowsForExisting(show, library, row);
    const ch = show.inputs[row];
    reset({ kind: "mic", rows: r.rows, src: r.src, label: r.src ? sourceLabel(r.src) : (ch?.source ?? "") });
  };

  const advance = (rows: number[]) => {
    const next = rows[rows.length - 1] + 1;
    onRow(next);
    reset({ kind: "source", row: next });
  };

  const pickMic = (choice: MicChoice) => {
    if (step.kind !== "mic") return;
    apply((s) => applyMicPick(s, step.rows, choice));
    const src = step.src;
    if (src && choice.kind === "library") updateLibrary((l) => learnPick(l, src.id, choice.mic.id));
    advance(step.rows);
  };

  const saveSource = (groupId: string) => {
    if (!prompt) return;
    const r = addSource(library, prompt.name, groupId);
    updateLibrary(() => r.lib);
    pickSource({ kind: "library", src: r.src }, r.lib);
  };

  const saveMic = (type: MicType) => {
    if (!prompt) return;
    const r = addMic(library, prompt.name, type);
    updateLibrary(() => r.lib);
    pickMic({ kind: "library", mic: r.mic });
  };

  /* ───────── 목록 ───────── */

  const q = norm(query);
  const sections: Section[] = useMemo(() => {
    if (step.kind === "source") {
      const out: Section[] = [];
      const srcItem = (s: SourceDef, prefix = ""): Item => ({
        key: prefix + s.id,
        label: sourceLabel(s),
        sub: s.stereo
          ? "2채널 · 링크"
          : s.numbered
            ? `→ ${channelsOf(s, nextSourceNumber(library, show, s, row))[0].source}`
            : undefined,
        swatch: s.color === "none" ? undefined : COLOR_SWATCH[s.color],
        run: () => pickSource({ kind: "library", src: s }),
      });
      const cur = show.inputs[row];
      if (!q && cur?.source)
        out.push({
          title: "지금 소스",
          items: [{ key: "keep", label: `${cur.source} 유지`, sub: "마이크만 고르기", run: keepSource }],
        });
      if (!q) {
        const next = suggestNextSources(library, show, row);
        if (next.length) out.push({ title: "다음 추천", items: next.map((s) => srcItem(s, "next-")) });
      }
      const match = (s: SourceDef) =>
        !q ||
        norm(s.name).includes(q) ||
        norm(s.shortName).includes(q) ||
        channelsOf(s).some((c) => norm(c.source).includes(q));
      for (const g of groupOrder) {
        const items = library.sources.filter((s) => s.groupId === g.id && match(s)).map((s) => srcItem(s));
        if (!items.length) continue;
        if (q) {
          out.push({ title: g.name, items }); // 검색 중에는 맞는 것을 모두 펼쳐서
          continue;
        }
        const isOpen = openSet.has(g.id);
        out.push({
          title: g.name,
          header: {
            key: `grp-${g.id}`,
            label: `${isOpen ? "▾" : "▸"} ${g.name}`,
            sub: isOpen ? undefined : `${items.length}개`,
            run: () => toggleGroup(g.id),
          },
          items: isOpen ? items : [],
        });
      }
      const exact = library.sources.some(
        (s) => norm(s.name) === q || channelsOf(s).some((c) => norm(c.source) === q),
      );
      if (q && !exact)
        out.push({
          title: "직접 입력",
          items: [{ key: "typed", label: `“${query.trim()}” 입력`, sub: "내 목록에 저장할지 묻습니다", run: () => setPrompt({ kind: "source", name: query.trim() }) }],
        });
      return out;
    }

    const need = step.rows.length;
    const micItem = (o: MicOption, prefix: string): Item => ({
      key: prefix + o.mic.id,
      label: o.mic.model,
      sub: [
        MIC_TYPE_LABEL[o.mic.type],
        o.mic.needsPhantom === null ? "48V 미확인" : o.mic.needsPhantom ? "48V" : "",
        o.mic.defaultStand,
      ]
        .filter(Boolean)
        .join(" · "),
      badge:
        o.remaining === null
          ? undefined
          : { text: `남음 ${o.remaining}/${o.mic.owned}`, bad: o.remaining < need },
      run: () => pickMic({ kind: "library", mic: o.mic }),
    });
    const { recommended, others } = micOptions(library, show, step.src);
    const match = (o: MicOption) =>
      (!micType || o.mic.type === micType) && (!q || norm(o.mic.model).includes(q) || norm(MIC_TYPE_LABEL[o.mic.type]).includes(q));
    const out: Section[] = [];
    const rec = recommended.filter(match);
    if (rec.length) out.push({ title: step.src ? "추천 (보유 장비 먼저)" : "추천", items: rec.map((o) => micItem(o, "rec-")) });
    const oth = others.filter(match);
    if (oth.length) out.push({ title: "다른 마이크·DI", items: oth.map((o) => micItem(o, "oth-")), compact: true });
    const exact = library.microphones.some((m) => norm(m.model) === q);
    if (q && !exact)
      out.push({
        title: "직접 입력",
        items: [{ key: "typed", label: `“${query.trim()}” 입력`, sub: "내 목록에 저장할지 묻습니다", run: () => setPrompt({ kind: "mic", name: query.trim() }) }],
      });
    out.push({
      title: "",
      items: [{ key: "skip", label: "마이크 없이 다음 채널", run: () => advance(step.rows) }],
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, q, query, library, show, row, open, groupOrder, micType]);

  const flat = sections.flatMap((s) => (s.header ? [s.header, ...s.items] : s.items));
  const hiClamped = Math.min(hi, Math.max(0, flat.length - 1));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      stop();
      if (prompt) setPrompt(null);
      else close();
      return;
    }
    if (prompt) return; // 질문 중에는 버튼끼리 Tab/Enter
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      stop();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setHi(Math.max(0, Math.min(flat.length - 1, hiClamped + d)));
    } else if (e.key === "Enter") {
      stop();
      flat[hiClamped]?.run();
    } else if (e.key === "Backspace" && query === "" && step.kind === "mic") {
      stop();
      onRow(step.rows[0]);
      reset({ kind: "source", row: step.rows[0] });
    }
  };

  /* ───────── 렌더 ───────── */

  const chNumber = (r: number) => show.inputs[r]?.number ?? nextNumber(show.inputs) + (r - show.inputs.length);
  const title =
    step.kind === "source"
      ? `Ch ${chNumber(row)} · 소스`
      : `Ch ${step.rows.map(chNumber).join("–")} · ${step.label || "소스 없음"} · 마이크`;
  const prev = row > 0 ? show.inputs[row - 1]?.source : "";

  const btnBase =
    "rounded-lg border text-left transition-colors border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800";

  let idx = -1;
  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/30" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-x-auto sm:top-12 sm:bottom-auto sm:left-1/2 sm:max-h-[80vh] sm:w-[720px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          {step.kind === "mic" && (
            <button
              className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => {
                onRow(step.rows[0]);
                reset({ kind: "source", row: step.rows[0] });
              }}
              title="소스 다시 고르기 (빈 검색창에서 ⌫)"
            >
              ←
            </button>
          )}
          <h2 className="mr-auto font-semibold">{title}</h2>
          {step.kind === "source" && prev && <span className="text-xs text-neutral-500">직전: {prev}</span>}
          <button
            className="rounded px-3 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={close}
            aria-label="닫기"
          >
            닫기 <kbd className="hidden sm:inline">Esc</kbd>
          </button>
        </div>

        {prompt ? (
          <div className="space-y-3 p-4">
            <p>
              <b>“{prompt.name}”</b>은(는) 내 {prompt.kind === "source" ? "소스" : "마이크"} 목록에 없습니다.{" "}
              {prompt.kind === "source" ? "저장할 악기군을 고르면 목록에 추가하고 사용합니다." : "종류를 고르면 목록에 추가하고 사용합니다."}
            </p>
            <div className="flex flex-wrap gap-2">
              {prompt.kind === "source"
                ? library.groups.map((g, i) => (
                    <button key={g.id} ref={i === 0 ? firstPromptBtn : undefined} className={`${btnBase} min-h-11 px-4`} onClick={() => saveSource(g.id)}>
                      {g.name}에 저장
                    </button>
                  ))
                : MIC_TYPES.map((t, i) => (
                    <button key={t} ref={i === 0 ? firstPromptBtn : undefined} className={`${btnBase} min-h-11 px-4`} onClick={() => saveMic(t)}>
                      {MIC_TYPE_LABEL[t]}로 저장
                    </button>
                  ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={`${btnBase} min-h-11 px-4`}
                onClick={() =>
                  prompt.kind === "source"
                    ? pickSource({ kind: "text", name: prompt.name })
                    : pickMic({ kind: "text", name: prompt.name })
                }
              >
                저장하지 않고 이번만 사용
              </button>
              <button className="min-h-11 px-4 text-neutral-500" onClick={() => setPrompt(null)}>
                취소
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 pt-3">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHi(0);
                }}
                placeholder={step.kind === "source" ? "소스 검색 또는 직접 입력" : "마이크 검색 또는 직접 입력"}
                aria-label="검색"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 dark:border-neutral-700"
              />
              {step.kind === "mic" && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs" role="group" aria-label="마이크 종류">
                  {([null, ...(Object.keys(MIC_TYPE_LABEL) as MicType[])] as (MicType | null)[]).map((t) => (
                    <button
                      key={t ?? "all"}
                      onClick={() => {
                        setMicType(t);
                        setHi(0);
                        searchRef.current?.focus();
                      }}
                      aria-pressed={micType === t}
                      className={`rounded-full border px-2.5 py-1 ${
                        micType === t ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-neutral-300 dark:border-neutral-700"
                      }`}
                    >
                      {t ? MIC_TYPE_LABEL[t] : "전체"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {sections.map((sec, si) => (
                <section key={si}>
                  {sec.header ? (
                    (() => {
                      idx++;
                      const isHi = idx === hiClamped;
                      return (
                        <button
                          data-hi={isHi || undefined}
                          aria-expanded={sec.items.length > 0}
                          onClick={sec.header.run}
                          className={`mb-1.5 flex min-h-9 w-full items-center gap-2 rounded px-1 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 ${isHi ? "ring-2 ring-blue-600" : ""}`}
                        >
                          {sec.header.label}
                          {sec.header.sub && <span className="text-xs font-normal text-neutral-400">{sec.header.sub}</span>}
                        </button>
                      );
                    })()
                  ) : (
                    sec.title && <h3 className="mb-1.5 text-xs font-medium text-neutral-500">{sec.title}</h3>
                  )}
                  <div className={`grid gap-2 ${sec.compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
                    {sec.items.map((it) => {
                      idx++;
                      const isHi = idx === hiClamped;
                      return (
                        <button
                          key={it.key}
                          data-hi={isHi || undefined}
                          onClick={it.run}
                          className={`${btnBase} flex min-h-11 flex-col justify-center px-3 py-1.5 ${
                            isHi ? "ring-2 ring-blue-600" : ""
                          } ${sec.compact ? "text-xs" : ""}`}
                        >
                          <span className="flex items-center gap-1.5">
                            {it.swatch && <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: it.swatch }} />}
                            <span className="font-medium">{it.label}</span>
                            {it.badge && (
                              <span className={`ml-auto shrink-0 rounded px-1.5 text-[11px] ${it.badge.bad ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                                {it.badge.text}
                              </span>
                            )}
                          </span>
                          {it.sub && <span className="text-[11px] text-neutral-500">{it.sub}</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <p className="hidden border-t border-neutral-200 px-4 py-2 text-[11px] text-neutral-500 sm:block dark:border-neutral-800">
              <kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 선택 · 글자 입력으로 검색 · {step.kind === "mic" && <><kbd>⌫</kbd> 소스로 돌아가기 · </>}<kbd>Esc</kbd> 닫기
            </p>
          </>
        )}
      </div>
    </div>
  );
}
