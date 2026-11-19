"use client";

/**
 * 목록 화면의 데이터 관리: 전체 백업·복원, 백업 알림, 영구 저장 요청, 첫 사용 안내.
 * 데이터는 이 브라우저(주소별)에만 있으므로 백업 파일이 유일한 바깥 사본이다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  backupFileName,
  backupStatus,
  backupToJson,
  markOf,
  parseBackup,
  restoreData,
  type AppData,
  type BackupMark,
  type BackupStatus,
  type RestoreMode,
} from "@/model/backup";
import { readAppData, writeAppData } from "@/storage/backupStore";
import { downloadText } from "@/lib/download";

const MARK_KEY = "onepatch.backupMark";
const WELCOME_KEY = "onepatch.welcomeSeen";
const PERSIST_DISMISS_KEY = "onepatch.persistNoticeDismissed";

const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const readMark = (): BackupMark | null => {
  try {
    return JSON.parse(ls.get(MARK_KEY) ?? "null");
  } catch {
    return null;
  }
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 60 / 24)}일 전`;
};

const btn = "rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

/* ───────────── 백업 ───────────── */

type Notify = (n: { kind: "info" | "error"; text: string; details?: string[] }) => void;

export function useBackup(onRestored: () => void, setMessage: Notify) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [pending, setPending] = useState<{ name: string; data: AppData; createdAt: string; skipped: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const data = await readAppData();
    setStatus(backupStatus(readMark(), markOf(data)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch(() => {});
    const onVis = () => document.visibilityState === "visible" && void refresh().catch(() => {});
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const backup = async () => {
    try {
      const data = await readAppData();
      const at = new Date();
      downloadText(backupFileName(at), backupToJson(data, at.toISOString()));
      ls.set(MARK_KEY, JSON.stringify(markOf(data, at.toISOString())));
      await refresh();
      setMessage({
        kind: "info",
        text: `전체 백업을 내려받았습니다: Show ${data.shows.length}개, 내 템플릿 ${(data.library?.blockTemplates.length ?? 0) + (data.library?.showTemplates.length ?? 0)}개, 콘솔 기준 파일 ${data.consoleFiles.length}개. 파일을 다른 곳(클라우드·USB)에도 보관하세요.`,
      });
    } catch (e) {
      setMessage({ kind: "error", text: `백업하지 못했습니다: ${String(e)}` });
    }
  };

  const pick = () => fileRef.current?.click();
  const onFile = async (f: File) => {
    const r = parseBackup(await f.text());
    if (!r.ok) return setMessage({ kind: "error", text: `가져오기 실패: ${f.name}`, details: r.errors });
    setPending({ name: f.name, data: r.data, createdAt: r.createdAt, skipped: r.skipped });
  };

  const restore = async (mode: RestoreMode) => {
    if (!pending) return;
    if (mode === "replace" && !confirm("지금 이 브라우저의 Show·라이브러리·기준 파일을 백업 내용으로 바꿉니다. 백업에 없는 Show는 지워집니다. 계속할까요?")) return;
    try {
      const current = await readAppData();
      const { data, report } = restoreData(current, pending.data, mode);
      await writeAppData(data);
      // 덮어쓰기면 지금 상태 = 그 백업이므로 백업한 것으로 본다
      if (mode === "replace") ls.set(MARK_KEY, JSON.stringify(markOf(data, pending.createdAt)));
      setPending(null);
      onRestored();
      await refresh();
      const r = report;
      setMessage({
        kind: "info",
        text:
          mode === "replace"
            ? `덮어썼습니다: Show ${data.shows.length}개${r.showsRemoved ? ` (백업에 없던 ${r.showsRemoved}개 지움)` : ""}, 내 라이브러리 ${r.libraryReplaced ? "백업 내용으로" : "그대로"}, 콘솔 기준 파일 ${r.consoleFiles}개. 다른 탭에 OnePatch가 열려 있으면 새로고침하세요.`
            : `합쳤습니다: 새 Show ${r.showsAdded}개, 더 최근 것으로 바꾼 Show ${r.showsUpdated}개, 그대로 둔 Show ${r.showsKept}개, 라이브러리·템플릿 새 항목 ${r.libraryItemsAdded}개, 기준 파일 ${r.consoleFiles}개. 다른 탭에 OnePatch가 열려 있으면 새로고침하세요.`,
        details: pending.skipped.length ? pending.skipped : undefined,
      });
    } catch (e) {
      setMessage({ kind: "error", text: `가져오지 못했습니다: ${String(e)}` });
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      aria-label="전체 백업 파일"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void onFile(f);
      }}
    />
  );
  return { status, backup, pick, input, pending, setPending, restore };
}

export function BackupBanner({ status, onBackup }: { status: BackupStatus | null; onBackup: () => void }) {
  if (!status?.due) return null;
  const parts = [
    status.changedShows ? `${status.never ? "Show" : "바뀐 Show"} ${status.changedShows}개` : "",
    status.removedShows ? `지운 Show ${status.removedShows}개` : "",
    status.libraryChanged ? "내 라이브러리·템플릿 변경" : "",
    status.consoleChanged ? "콘솔 기준 파일 변경" : "",
  ].filter(Boolean);
  return (
    <div role="status" aria-label="백업 알림" className="mb-4 flex flex-wrap items-center gap-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <span>
        {status.never ? "아직 전체 백업을 한 적이 없습니다" : `마지막 백업 ${ago(status.at!)} 이후`} — {parts.join(", ")}
      </span>
      <button className="ml-auto rounded border border-amber-500 px-3 py-1 font-medium" onClick={onBackup}>
        지금 전체 백업 <kbd>B</kbd>
      </button>
    </div>
  );
}

export function RestoreDialog({ pending, onRestore, onClose }: { pending: { name: string; data: AppData; createdAt: string; skipped: string[] }; onRestore: (m: RestoreMode) => void; onClose: () => void }) {
  const [mode, setMode] = useState<RestoreMode>("merge");
  const d = pending.data;
  const tpl = (d.library?.blockTemplates.length ?? 0) + (d.library?.showTemplates.length ?? 0);
  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="전체 백업 가져오기" className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-white p-4 shadow-2xl sm:inset-x-auto sm:top-20 sm:bottom-auto sm:left-1/2 sm:w-[520px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900">
        <h2 className="font-semibold">전체 백업 가져오기</h2>
        <p className="text-sm">
          <b>{pending.name}</b>
          <span className="text-neutral-500"> · 백업 시각 {new Date(pending.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</span>
        </p>
        <ul className="list-disc pl-5 text-sm">
          <li>Show {d.shows.length}개{d.shows.length ? `: ${d.shows.slice(0, 4).map((s) => s.title).join(", ")}${d.shows.length > 4 ? " …" : ""}` : ""}</li>
          <li>내 라이브러리 {d.library ? `마이크 ${d.library.microphones.length} · 소스 ${d.library.sources.length} · 내 템플릿 ${tpl}` : "없음"}</li>
          <li>콘솔 기준 파일 {d.consoleFiles.length ? d.consoleFiles.map((f) => f.name).join(", ") : "없음"}</li>
        </ul>
        {pending.skipped.length > 0 && <p className="text-xs text-red-600">읽지 못해 건너뛸 항목 {pending.skipped.length}개: {pending.skipped.join(" / ")}</p>}
        <fieldset className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} className="mt-1" />
            <span>
              <b>합치기</b> (권장) — 지금 데이터는 두고 백업에서 없는 것만 더합니다. 같은 Show는 더 최근에 고친 쪽을 남기고, 라이브러리·템플릿은 새 항목만 더합니다.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-1" />
            <span>
              <b>덮어쓰기</b> — 이 브라우저의 데이터를 백업과 똑같이 만듭니다. 백업에 없는 Show는 지워집니다.
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button className="min-h-10 px-4 text-neutral-500" onClick={onClose}>
            취소
          </button>
          <button className={`min-h-10 rounded-lg border px-4 font-medium ${mode === "replace" ? "border-red-500 text-red-700" : "border-blue-500 text-blue-700 dark:text-blue-300"}`} onClick={() => onRestore(mode)}>
            {mode === "replace" ? "덮어쓰기" : "합치기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 영구 저장 ───────────── */

export function PersistNotice() {
  const [state, setState] = useState<"unknown" | "granted" | "denied" | "unsupported">("unknown");
  const [dismissed, setDismissed] = useState(true);
  const [usage, setUsage] = useState<string | null>(null);

  const ask = useCallback(async () => {
    if (!navigator.storage?.persist) return setState("unsupported");
    const already = await navigator.storage.persisted();
    const ok = already || (await navigator.storage.persist());
    setState(ok ? "granted" : "denied");
    const est = await navigator.storage.estimate?.();
    if (est?.usage !== undefined) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)}MB 사용`);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(ls.get(PERSIST_DISMISS_KEY) === "1");
    void ask().catch(() => setState("unsupported"));
  }, [ask]);

  if (state === "granted" || state === "unknown" || dismissed) return null;
  return (
    <div role="status" aria-label="저장 공간" className="mb-4 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-2">
        <b>이 브라우저가 데이터를 영구 저장으로 허용하지 않았습니다.</b>
        <span className="text-neutral-500">{usage}</span>
        <span className="ml-auto flex gap-2">
          <button className={btn} onClick={() => void ask()}>
            다시 요청
          </button>
          <button
            className="px-2 text-neutral-500"
            onClick={() => {
              ls.set(PERSIST_DISMISS_KEY, "1");
              setDismissed(true);
            }}
          >
            닫기
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        저장 공간이 부족하거나 오래 쓰지 않으면 브라우저가 데이터를 지울 수 있습니다. 홈 화면에 추가(설치)하면 대부분 허용됩니다 — iPhone·iPad: Safari 공유 → 홈 화면에 추가 /
        Android·PC Chrome: 주소창의 설치 아이콘. {state === "unsupported" ? "이 브라우저는 영구 저장 요청을 지원하지 않습니다. " : ""}어느 경우든 <b>전체 백업</b>을 자주 해 두세요.
      </p>
    </div>
  );
}

/* ───────────── 첫 사용 안내 ───────────── */

export function useWelcome() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ls.get(WELCOME_KEY) !== "1") setOpen(true);
  }, []);
  const close = () => {
    ls.set(WELCOME_KEY, "1");
    setOpen(false);
  };
  return { open, show: () => setOpen(true), close };
}

export function Welcome({ onSample, onClose }: { onSample: () => void; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const card = "rounded-lg border border-neutral-200 p-3 dark:border-neutral-800";
  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="OnePatch 처음 사용 안내" className="absolute inset-x-0 bottom-0 max-h-[92vh] space-y-3 overflow-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:inset-x-auto sm:top-12 sm:bottom-auto sm:left-1/2 sm:w-[560px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900">
        <h2 className="text-lg font-bold">OnePatch 시작하기</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">인풋리스트를 한 번 입력하면 크루용 문서와 콘솔 파일이 나옵니다.</p>
        <div className={card}>
          <h3 className="font-semibold">1. 샘플 Show 열어 보기</h3>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-400">5인조 밴드 26채널이 채워진 예시입니다. 마음대로 고쳐 보고 지워도 됩니다.</p>
          <button ref={ref} className="rounded border border-blue-500 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300" onClick={onSample}>
            샘플 Show 열기
          </button>
        </div>
        <div className={card}>
          <h3 className="font-semibold">2. 누르기 입력</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            인풋 표의 <b>Ch 번호 칸</b>을 누르면(또는 그 칸에서 <kbd>Space</kbd>) 악기 → 소스 → 마이크를 차례로 눌러 한 채널이 채워지고 다음 채널로 넘어갑니다. 키보드로는 스프레드시트처럼
            바로 입력할 수 있습니다.
          </p>
        </div>
        <div className={card}>
          <h3 className="font-semibold">3. 내보내기는 Show 화면 위쪽</h3>
          <ul className="list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
            <li>
              <b>출력·인쇄</b> (<kbd>P</kbd>) — 인풋·아웃풋 리스트, 패치 시트, 집계표, 라벨, 콘솔 할 일 → PDF·엑셀
            </li>
            <li>
              <b>콘솔 내보내기</b> — Yamaha DM7 쇼 파일(.dmxf)
            </li>
          </ul>
        </div>
        <p className="text-xs text-neutral-500">
          데이터는 이 브라우저에만 저장됩니다. 한 번 열어 둔 뒤에는 인터넷 없이도 열리며, 홈 화면에 추가해 두면 앱처럼 쓸 수 있습니다. 목록 화면의 <b>전체 백업</b>으로 가끔 파일을 받아 두세요.
        </p>
        <div className="flex justify-end">
          <button className={btn} onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
