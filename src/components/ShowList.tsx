"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createEmptyShow, duplicateShow, newId } from "@/model/factory";
import { parseShowJson, showToJson } from "@/model/serialize";
import { createSampleShow } from "@/sample/fivePieceBand";
import {
  deleteShow,
  getShow,
  listShows,
  putShow,
  type ShowSummary,
} from "@/storage/showStore";
import { isTypingTarget } from "@/lib/download";
import { BUILTIN_SHOW_TEMPLATES, showFromTemplate } from "@/model/templates";
import type { Show } from "@/model/schema";
import { useLibrary } from "./useLibrary";
import ChoiceSheet from "./ChoiceSheet";
import { applyShowInfo, EDIT_TITLE_KEY } from "@/model/showInfo";

type Notice = { kind: "info" | "error"; text: string; details?: string[] };

export default function ShowList() {
  const router = useRouter();
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { library } = useLibrary();
  const [tplOpen, setTplOpen] = useState(false);
  /** 이름 바꾸는 중인 Show id */
  const [renaming, setRenaming] = useState<string | null>(null);

  const refresh = useCallback(async (selectId?: string) => {
    const list = await listShows();
    setShows(list);
    if (selectId) setSelected(Math.max(0, list.findIndex((s) => s.id === selectId)));
    else setSelected((i) => Math.min(i, Math.max(0, list.length - 1)));
  }, []);

  useEffect(() => {
    // 마운트 시 IndexedDB에서 목록을 한 번 불러온다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch((e) => setNotice({ kind: "error", text: String(e) }));
  }, [refresh]);

  const current = shows?.[selected];

  const actions = {
    create: async () => {
      const show = createEmptyShow();
      await putShow(show);
      await refresh(show.id);
      setNotice({ kind: "info", text: "새 Show를 만들었습니다. 공연명을 입력하고 Enter를 누르세요." });
      setRenaming(show.id);
    },
    rename: async (id: string, title: string) => {
      const show = await getShow(id);
      if (!show) return;
      const next = applyShowInfo(show, { title });
      if (next === show) return;
      await putShow({ ...next, updatedAt: new Date().toISOString() });
      await refresh(id);
      setNotice({ kind: "info", text: `이름을 “${next.title}”(으)로 바꿨습니다.` });
    },
    addSample: async () => {
      const show = createSampleShow();
      await putShow(show);
      await refresh(show.id);
      setNotice({ kind: "info", text: "샘플 Show를 추가했습니다." });
    },
    open: (id: string) => router.push(`/shows/${id}`),
    /** 템플릿으로 만들고 바로 연다 */
    fromTemplate: async (show: Show) => {
      await putShow(show);
      try {
        sessionStorage.setItem(EDIT_TITLE_KEY, show.id);
      } catch {}
      router.push(`/shows/${show.id}`);
    },
    duplicate: async (id: string) => {
      const show = await getShow(id);
      if (!show) return;
      const copy = duplicateShow(show);
      await putShow(copy);
      await refresh(copy.id);
      setNotice({ kind: "info", text: `"${copy.title}"을(를) 만들었습니다.` });
    },
    remove: async (s: ShowSummary) => {
      if (!confirm(`"${s.title}"을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
      await deleteShow(s.id);
      await refresh();
      setNotice({ kind: "info", text: "삭제했습니다." });
    },
    importFile: async (file: File) => {
      const result = parseShowJson(await file.text());
      if (!result.ok) {
        setNotice({ kind: "error", text: `가져오기 실패: ${file.name}`, details: result.errors });
        return;
      }
      const incoming = result.show;
      const existing = await getShow(incoming.id);
      if (existing) {
        if (showToJson(existing) === showToJson(incoming)) {
          await refresh(incoming.id);
          setNotice({ kind: "info", text: "저장된 Show와 내용이 완전히 같습니다. (변경 없음)" });
          return;
        }
        const overwrite = confirm(
          `같은 Show("${existing.title}")가 이미 있습니다.\n확인: 덮어쓰기 / 취소: 사본으로 가져오기`,
        );
        if (!overwrite) {
          incoming.id = newId();
          incoming.title = `${incoming.title} (가져옴)`;
        }
      }
      await putShow(incoming);
      await refresh(incoming.id);
      setNotice({ kind: "info", text: `가져왔습니다: ${incoming.title}` });
    },
  };

  const run = (p: Promise<unknown> | void) =>
    p?.catch((e: unknown) => setNotice({ kind: "error", text: String(e) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tplOpen || renaming || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = shows?.length ?? 0;
      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (n) setSelected((i) => Math.min(n - 1, i + 1));
          break;
        case "ArrowUp":
        case "k":
          if (n) setSelected((i) => Math.max(0, i - 1));
          break;
        case "Enter":
          if (current) actions.open(current.id);
          break;
        case "n":
          run(actions.create());
          break;
        case "d":
          if (current) run(actions.duplicate(current.id));
          break;
        case "F2":
          if (current) setRenaming(current.id);
          break;
        case "Delete":
        case "Backspace":
          if (current) run(actions.remove(current));
          break;
        case "i":
          fileRef.current?.click();
          break;
        case "t":
          setTplOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const btn =
    "rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800";

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <header className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">OnePatch</h1>
        <Link href="/library" className={btn}>
          내 장비·소스
        </Link>
        <button className={btn} onClick={() => run(actions.create())}>
          새 Show <kbd>N</kbd>
        </button>
        <button className={btn} onClick={() => setTplOpen(true)}>
          템플릿으로 새 Show <kbd>T</kbd>
        </button>
        <button className={btn} onClick={() => fileRef.current?.click()}>
          JSON 가져오기 <kbd>I</kbd>
        </button>
        <button className={btn} onClick={() => run(actions.addSample())}>
          샘플 추가
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) run(actions.importFile(f));
          }}
        />
      </header>

      {notice && (
        <div
          role="status"
          className={`mb-4 rounded border px-3 py-2 text-sm ${
            notice.kind === "error"
              ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
              : "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
          }`}
        >
          <div className="flex justify-between gap-4">
            <span>{notice.text}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setNotice(null)}>
              닫기
            </button>
          </div>
          {notice.details && (
            <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5 font-mono text-xs">
              {notice.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {shows === null ? (
        <p className="text-neutral-500">불러오는 중…</p>
      ) : shows.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <p className="mb-4 text-neutral-500">저장된 Show가 없습니다.</p>
          <button className={btn} onClick={() => run(actions.addSample())}>
            샘플 Show로 시작하기
          </button>
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500 dark:border-neutral-700">
              <th className="py-2 pr-3 font-medium">공연명</th>
              <th className="py-2 pr-3 font-medium">날짜</th>
              <th className="py-2 pr-3 font-medium">장소</th>
              <th className="py-2 pr-3 font-medium">버전</th>
              <th className="py-2 pr-3 text-right font-medium">In/Out</th>
              <th className="py-2 pr-3 font-medium">수정</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {shows.map((s, i) => (
              <tr
                key={s.id}
                aria-selected={i === selected}
                onClick={() => setSelected(i)}
                onDoubleClick={() => actions.open(s.id)}
                className={`cursor-default border-b border-neutral-200 dark:border-neutral-800 ${
                  i === selected ? "bg-blue-50 dark:bg-blue-950" : ""
                }`}
              >
                <td className="py-2 pr-3 font-medium">
                  {renaming === s.id ? (
                    <RenameInput
                      initial={s.title}
                      onDone={(t) => {
                        setRenaming(null);
                        if (t !== null) run(actions.rename(s.id, t));
                      }}
                    />
                  ) : (
                    s.title
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">{s.date || "—"}</td>
                <td className="py-2 pr-3">{s.venue || "—"}</td>
                <td className="py-2 pr-3">{s.version}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {s.inputCount}/{s.outputCount}
                </td>
                <td className="py-2 pr-3 tabular-nums text-neutral-500">
                  {new Date(s.updatedAt).toLocaleString("ko-KR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button className="px-1.5 hover:underline" onClick={() => actions.open(s.id)}>
                    열기
                  </button>
                  <button className="px-1.5 hover:underline" onClick={() => setRenaming(s.id)} title="F2">
                    이름 바꾸기
                  </button>
                  <button
                    className="px-1.5 hover:underline"
                    onClick={() => run(actions.duplicate(s.id))}
                  >
                    복제
                  </button>
                  <button
                    className="px-1.5 text-red-600 hover:underline"
                    onClick={() => run(actions.remove(s))}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-xs text-neutral-500">
        <kbd>↑</kbd>
        <kbd>↓</kbd> 선택 · <kbd>Enter</kbd> 열기 · <kbd>F2</kbd> 이름 바꾸기 · <kbd>D</kbd> 복제 · <kbd>Delete</kbd> 삭제
        · <kbd>N</kbd> 새 Show · <kbd>T</kbd> 템플릿으로 새 Show · <kbd>I</kbd> 가져오기 — 데이터는 이 브라우저에만 저장됩니다.
      </p>

      {tplOpen && (
        <ChoiceSheet
          title="템플릿으로 새 Show"
          query=""
          setQuery={() => {}}
          placeholder="고르면 새 Show를 만들고 엽니다"
          sections={[
            {
              title: "기본 틀",
              items: [
                { key: "empty", label: "빈 Show", sub: "Rio3224+Rio1608, Main L/R·Mono/Sub만", run: () => run(actions.fromTemplate(createEmptyShow())) },
                ...BUILTIN_SHOW_TEMPLATES.map((t) => ({ key: t.id, label: t.name, sub: t.description, run: () => run(actions.fromTemplate(t.build())) })),
              ],
            },
            ...(library?.showTemplates.length
              ? [
                  {
                    title: "내 Show 템플릿",
                    items: library.showTemplates.map((t) => ({
                      key: t.id,
                      label: t.name,
                      sub: `인풋 ${t.show.inputs.length}ch · 아웃풋 ${t.show.outputs.length} · DCA ${t.show.dcas.length} · 박스 ${t.show.stageBoxes.map((b) => b.name).join("+")}`,
                      run: () => run(actions.fromTemplate(showFromTemplate(t, `${t.name} (새 Show)`))),
                    })),
                  },
                ]
              : []),
          ]}
          onClose={() => setTplOpen(false)}
          hint={<><kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 만들고 열기 · <kbd>Esc</kbd> 닫기 · 내 템플릿은 Show 화면의 “Show 템플릿으로 저장”으로 만듭니다</>}
        />
      )}
    </main>
  );
}

/** 목록에서 이름 바꾸기: Enter 확정 · Esc 취소 · 빈 이름은 받지 않음 (onDone(null) = 취소) */
function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
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
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            if (draft.trim()) finish(draft.trim());
            else setError(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
        onBlur={() => finish(draft.trim() || null)}
        className={`w-full min-w-[16ch] rounded border bg-transparent px-1 outline-none focus:ring-2 ${error ? "border-red-500 focus:ring-red-500" : "border-neutral-300 focus:ring-blue-600 dark:border-neutral-700"}`}
      />
      {error && <span className="text-xs font-normal text-red-600">공연명은 비워 둘 수 없습니다.</span>}
    </span>
  );
}
