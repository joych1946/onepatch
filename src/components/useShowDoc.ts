"use client";

/**
 * 편집 중인 Show 문서: 실행 취소/다시 실행 히스토리 + 자동 저장.
 * - 변경은 apply(fn)로만 한다. fn이 같은 객체를 돌려주면 변경 없음으로 본다.
 * - 저장은 변경 후 잠시 뒤(디바운스). 검증 오류가 있는 동안은 저장하지 않고 상태로 알린다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Show } from "@/model/schema";
import { checkShow, ShowSchema } from "@/model/schema";
import { getShow, putShow } from "@/storage/showStore";

const HISTORY_LIMIT = 300;
const SAVE_DELAY_MS = 500;

type Doc = { past: Show[]; present: Show; future: Show[] };

export type SaveStatus =
  | { kind: "saved"; at: string | null }
  | { kind: "pending" }
  | { kind: "invalid"; count: number }
  | { kind: "error"; message: string };

export type ValidationIssue = { path: PropertyKey[]; message: string };

export function useShowDoc(id: string) {
  const [doc, setDoc] = useState<Doc | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved", at: null });
  const savedRef = useRef<Show | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getShow(id).then(
      (show) => {
        savedRef.current = show;
        setDoc(show ? { past: [], present: show, future: [] } : null);
      },
      (e) => setLoadError(String(e)),
    );
  }, [id]);

  const present = doc?.present ?? null;

  /** errors: 저장을 막는 문제 / warnings: 저장은 되지만 고쳐야 할 것 */
  const { errors, warnings } = useMemo(() => {
    if (!present) return { errors: [] as ValidationIssue[], warnings: [] as ValidationIssue[] };
    const r = ShowSchema.safeParse(present);
    return {
      errors: r.success ? [] : r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      warnings: checkShow(present).warnings as ValidationIssue[],
    };
  }, [present]);

  const save = useCallback(async (show: Show) => {
    try {
      await putShow(show);
      savedRef.current = show;
      setStatus({ kind: "saved", at: new Date().toLocaleTimeString("ko-KR") });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  // 자동 저장
  useEffect(() => {
    if (!present || present === savedRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    if (errors.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus({ kind: "invalid", count: errors.length });
      return;
    }
    setStatus({ kind: "pending" });
    timer.current = setTimeout(() => save(present), SAVE_DELAY_MS);
  }, [present, errors, save]);

  // 페이지를 떠날 때: 대기 중이면 즉시 저장, 저장 못 한 변경이 있으면 경고
  const latest = useRef({ present, valid: true });
  useEffect(() => {
    latest.current = { present, valid: errors.length === 0 };
  }, [present, errors]);

  useEffect(() => {
    const unsaved = () => {
      const { present: p } = latest.current;
      return p !== null && p !== savedRef.current;
    };
    const flush = () => {
      if (unsaved() && latest.current.valid) {
        if (timer.current) clearTimeout(timer.current);
        void save(latest.current.present!);
      }
    };
    const warn = (e: BeforeUnloadEvent) => {
      if (unsaved() && !latest.current.valid) e.preventDefault();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", warn);
      flush(); // 라우트 이동(언마운트) 시
    };
  }, [save]);

  const apply = useCallback((fn: (s: Show) => Show) => {
    setDoc((d) => {
      if (!d) return d;
      const next = fn(d.present);
      if (next === d.present) return d;
      return {
        past: [...d.past, d.present].slice(-HISTORY_LIMIT),
        present: { ...next, updatedAt: new Date().toISOString() },
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setDoc((d) =>
      d && d.past.length
        ? { past: d.past.slice(0, -1), present: d.past[d.past.length - 1], future: [d.present, ...d.future] }
        : d,
    );
  }, []);

  const redo = useCallback(() => {
    setDoc((d) =>
      d && d.future.length
        ? { past: [...d.past, d.present], present: d.future[0], future: d.future.slice(1) }
        : d,
    );
  }, []);

  return {
    show: present,
    notFound: doc === null,
    loadError,
    status,
    errors,
    warnings,
    apply,
    undo,
    redo,
    canUndo: !!doc?.past.length,
    canRedo: !!doc?.future.length,
  };
}
