"use client";

/** 템플릿 창들: 블록 삽입 선택, 이름 짓고 저장 */
import { useEffect, useRef, useState } from "react";
import type { Show } from "@/model/schema";
import type { Library } from "@/model/library";
import { BUILTIN_BLOCKS, insertBlock, resolveBuiltin } from "@/model/templates";
import type { TemplateChannel } from "@/model/library";
import { norm } from "@/model/text";
import ChoiceSheet, { type ChoiceItem } from "./ChoiceSheet";

const preview = (chs: TemplateChannel[]) => {
  const names = chs.map((c) => c.source || c.shortName).filter(Boolean);
  return names.length > 6 ? `${names.slice(0, 6).join(", ")} …` : names.join(", ");
};

/**
 * 블록 템플릿 고르기. 고를 때마다 삽입 위치 앞에 끼워 넣고, 다음 블록은 그 뒤에 이어진다(창은 열린 채로).
 */
export function BlockPicker({
  show,
  library,
  at,
  renumber,
  apply,
  onInserted,
  onClose,
}: {
  show: Show;
  library: Library;
  /** 이 행 앞에 넣는다 (행 수와 같으면 맨 끝) */
  at: number;
  renumber: boolean;
  apply: (fn: (s: Show) => Show) => void;
  /** 들어간 행 범위 → 다음 삽입 위치는 to+1 */
  onInserted: (from: number, to: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = norm(query);
  const insert = (channels: TemplateChannel[]) => {
    const r = insertBlock(show, library, channels, at, renumber);
    apply(() => r.show);
    onInserted(r.from, r.to);
  };
  const match = (name: string, chs: TemplateChannel[]) =>
    !q || norm(name).includes(q) || chs.some((c) => norm(c.source).includes(q) || norm(c.shortName).includes(q));

  const builtin: ChoiceItem[] = BUILTIN_BLOCKS.map((b) => ({ b, chs: resolveBuiltin(b, library, show) }))
    .filter(({ b, chs }) => chs.length && match(b.name, chs))
    .map(({ b, chs }) => ({ key: b.id, label: b.name, badge: `${chs.length}ch`, sub: preview(chs), run: () => insert(chs) }));
  const mine: ChoiceItem[] = library.blockTemplates
    .filter((t) => match(t.name, t.channels))
    .map((t) => ({ key: t.id, label: t.name, badge: `${t.channels.length}ch`, sub: preview(t.channels), run: () => insert(t.channels) }));

  const where = at >= show.inputs.length ? "맨 끝에" : `Ch ${show.inputs[at].number} ${show.inputs[at].source} 앞에`;
  return (
    <ChoiceSheet
      title={`블록 템플릿 넣기 · ${where}`}
      query={query}
      setQuery={setQuery}
      placeholder="템플릿 검색"
      sections={[
        ...(builtin.length ? [{ title: "기본 블록", items: builtin }] : []),
        ...(mine.length ? [{ title: "내 템플릿", items: mine }] : []),
      ]}
      onClose={onClose}
      resetKey={at}
      extra={<p className="mt-2 text-xs text-neutral-500">누를 때마다 차례로 이어서 들어갑니다 (지금 {show.inputs.length}ch). 채널 번호·패치는 위 채널에 이어서 매깁니다.</p>}
      hint={<><kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 넣기(창은 열린 채로) · <kbd>Esc</kbd> 닫기 · 선택한 채널은 툴바 “템플릿으로 저장”</>}
    />
  );
}

/** 이름을 받아 저장하는 작은 창 */
export function SaveNameDialog({
  title,
  description,
  initial,
  onSave,
  onClose,
  label = "템플릿 이름",
  selectAll = true,
}: {
  title: string;
  description: string;
  initial: string;
  label?: string;
  /** false면 글자 끝에 커서 (제안 이름 뒤에 이어 쓰기) */
  selectAll?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (selectAll) ref.current?.select();
    else ref.current?.setSelectionRange(initial.length, initial.length);
    // 열 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = () => name.trim() && onSave(name.trim());
  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-white p-4 shadow-2xl sm:inset-x-auto sm:top-24 sm:bottom-auto sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900"
      >
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-neutral-500">{description}</p>
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={label}
          className="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 dark:border-neutral-700"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="min-h-10 px-4 text-neutral-500" onClick={onClose}>
            취소
          </button>
          <button type="submit" disabled={!name.trim()} className="min-h-10 rounded-lg border border-blue-500 px-4 font-medium text-blue-700 disabled:opacity-40 dark:text-blue-300">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
