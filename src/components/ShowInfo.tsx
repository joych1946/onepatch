"use client";

/**
 * 공연 정보 편집 화면: 제목 그 자리 편집(TitleEditor) + 공연 정보 대화상자(ShowInfoDialog).
 * 계산은 src/model/showInfo.ts. 변경은 부모가 apply로 넣어 실행 취소·자동 저장을 그대로 따른다.
 */
import { useEffect, useRef, useState } from "react";
import { normalizeShowInfo, showInfoProblems, type ShowInfo } from "@/model/showInfo";

/**
 * 제목을 누르면 그 자리에서 고친다. Enter 확정 · Esc 취소 · 다른 곳을 누르면 확정(빈 이름이면 취소).
 * 키 입력은 이 칸에서 멈춰 그리드·화면 단축키로 가지 않는다.
 */
export function TitleEditor({
  title,
  editing,
  setEditing,
  onCommit,
  className = "",
}: {
  title: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onCommit: (title: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  /** Enter·Esc로 끝낸 뒤 따라오는 blur를 무시 */
  const closed = useRef(false);

  useEffect(() => {
    if (!editing) return;
    closed.current = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(title);
    setError(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    // 편집을 시작할 때의 제목으로만 초기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = (blur: boolean) => {
    if (closed.current) return;
    const t = draft.trim();
    if (!t) {
      if (blur) setEditing(false);
      else setError(true);
      return;
    }
    closed.current = true;
    if (t !== title) onCommit(t);
    setEditing(false);
  };

  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="눌러서 공연명 고치기"
        className={`rounded text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${className}`}
      >
        {title}
      </button>
    );

  return (
    <span className="inline-flex flex-col">
      <input
        ref={ref}
        value={draft}
        aria-label="공연명"
        aria-invalid={error}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commit(false);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closed.current = true;
            setEditing(false);
          }
        }}
        onBlur={() => commit(true)}
        className={`min-w-[16ch] rounded border bg-transparent px-1 outline-none focus:ring-2 ${
          error ? "border-red-500 focus:ring-red-500" : "border-neutral-300 focus:ring-blue-600 dark:border-neutral-700"
        } ${className}`}
      />
      <span className={`text-xs font-normal ${error ? "text-red-600" : "text-neutral-500"}`}>
        {error ? "공연명은 비워 둘 수 없습니다." : "Enter 확정 · Esc 취소"}
      </span>
    </span>
  );
}

const FIELDS: { key: Exclude<keyof ShowInfo, "notes">; label: string; type?: string; placeholder?: string }[] = [
  { key: "title", label: "공연명" },
  { key: "date", label: "날짜", type: "date" },
  { key: "venue", label: "장소" },
  { key: "author", label: "작성자" },
  { key: "version", label: "버전", placeholder: "예: v3, 리허설 후" },
];

/** 공연 정보 대화상자. 저장하면 한 번의 변경(실행 취소 한 번)으로 들어간다. */
export function ShowInfoDialog({ info, onSave, onClose }: { info: ShowInfo; onSave: (info: ShowInfo) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(info);
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, []);
  const problems = showInfoProblems(draft);
  const problem = (k: keyof ShowInfo) => (tried ? problems.find((p) => p.field === k)?.message : undefined);
  const save = () => {
    setTried(true);
    if (!problems.length) onSave(normalizeShowInfo(draft));
  };
  const input =
    "w-full rounded-lg border bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600 dark:border-neutral-700";

  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        // 대화상자 안의 키는 화면·그리드 단축키로 보내지 않는다
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="공연 정보"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="absolute inset-x-0 bottom-0 max-h-[90vh] space-y-3 overflow-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:inset-x-auto sm:top-16 sm:bottom-auto sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900"
      >
        <h2 className="font-semibold">공연 정보</h2>
        <div className="grid grid-cols-[5rem_1fr] items-start gap-x-3 gap-y-2 text-sm">
          {FIELDS.map((f, i) => (
            <label key={f.key} className="contents">
              <span className="pt-2 text-neutral-500">{f.label}</span>
              <span>
                <input
                  ref={i === 0 ? first : undefined}
                  type={f.type ?? "text"}
                  value={draft[f.key]}
                  placeholder={f.placeholder}
                  aria-invalid={!!problem(f.key)}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className={`${input} ${problem(f.key) ? "border-red-500" : "border-neutral-300"}`}
                />
                {problem(f.key) && <span className="mt-0.5 block text-xs text-red-600">{problem(f.key)}</span>}
                {f.key === "date" && draft.date && (
                  <button type="button" className="mt-0.5 text-xs text-neutral-500 hover:underline" onClick={() => setDraft((d) => ({ ...d, date: "" }))}>
                    날짜 비우기 (미정)
                  </button>
                )}
              </span>
            </label>
          ))}
          <label className="contents">
            <span className="pt-2 text-neutral-500">메모</span>
            <textarea
              rows={4}
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              className={`${input} border-neutral-300`}
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-neutral-500">
            <kbd>Enter</kbd> 저장 (메모에서는 <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd>) · <kbd>Esc</kbd> 취소
          </span>
          <button type="button" className="min-h-10 px-4 text-neutral-500" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="min-h-10 rounded-lg border border-blue-500 px-4 font-medium text-blue-700 dark:text-blue-300">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}
