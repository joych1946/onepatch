"use client";

/**
 * 누르기 선택 창 공통 틀 (아웃풋 이름, DCA·뮤트 멤버).
 * 폰·태블릿: 아래에서 올라오는 시트, 큰 버튼 / 키보드: 검색 입력, ↑↓, Enter, Esc
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ChoiceItem = {
  key: string;
  label: string;
  sub?: string;
  badge?: string;
  /** 켜진 상태 (멤버 선택처럼 여러 개를 켜고 끄는 목록) */
  selected?: boolean;
  run: () => void;
};
export type ChoiceSection = { title: string; items: ChoiceItem[] };

interface Props {
  title: string;
  query: string;
  setQuery: (q: string) => void;
  placeholder: string;
  sections: ChoiceSection[];
  onClose: () => void;
  /** 검색창 아래 추가 내용 */
  extra?: ReactNode;
  hint?: ReactNode;
  /** 바뀌면 강조 위치를 처음으로 (단계가 바뀔 때) */
  resetKey?: string | number;
}

export default function ChoiceSheet({ title, query, setQuery, placeholder, sections, onClose, extra, hint, resetKey }: Props) {
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const touch = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches, []);
  const flat = sections.flatMap((s) => s.items);
  const hiC = Math.min(hi, Math.max(0, flat.length - 1));

  useEffect(() => {
    if (!touch) searchRef.current?.focus();
  }, [touch, resetKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHi(0);
  }, [resetKey]);
  useEffect(() => {
    listRef.current?.querySelector("[data-hi]")?.scrollIntoView({ block: "nearest" });
  }, [hiC]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "Escape") {
      stop();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      stop();
      setHi(Math.max(0, Math.min(flat.length - 1, hiC + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      stop();
      flat[hiC]?.run();
    }
  };

  const btn = "rounded-lg border text-left transition-colors border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  let idx = -1;
  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-x-auto sm:top-12 sm:bottom-auto sm:left-1/2 sm:max-h-[80vh] sm:w-[720px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="mr-auto font-semibold">{title}</h2>
          <button className="rounded px-3 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose} aria-label="닫기">
            닫기 <kbd className="hidden sm:inline">Esc</kbd>
          </button>
        </div>
        <div className="px-4 pt-3">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
            }}
            placeholder={placeholder}
            aria-label="검색"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 dark:border-neutral-700"
          />
          {extra}
        </div>
        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {sections.map((sec, si) => (
            <section key={si}>
              {sec.title && <h3 className="mb-1.5 text-xs font-medium text-neutral-500">{sec.title}</h3>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {sec.items.map((it) => {
                  idx++;
                  const isHi = idx === hiC;
                  return (
                    <button
                      key={it.key}
                      data-hi={isHi || undefined}
                      aria-pressed={it.selected}
                      onClick={it.run}
                      className={`${btn} flex min-h-11 flex-col justify-center px-3 py-1.5 ${isHi ? "ring-2 ring-blue-600" : ""} ${
                        it.selected ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : ""
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {it.selected !== undefined && <span aria-hidden>{it.selected ? "☑" : "☐"}</span>}
                        <span className="font-medium">{it.label}</span>
                        {it.badge && <span className="ml-auto shrink-0 rounded bg-neutral-100 px-1.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{it.badge}</span>}
                      </span>
                      {it.sub && <span className="text-[11px] text-neutral-500">{it.sub}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {hint && <p className="hidden border-t border-neutral-200 px-4 py-2 text-[11px] text-neutral-500 sm:block dark:border-neutral-800">{hint}</p>}
      </div>
    </div>
  );
}
