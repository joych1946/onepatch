"use client";

/**
 * 편집 중인 Show 문서: 실행 취소/다시 실행 히스토리 + 자동 저장.
 * - 변경은 apply(fn)로만 한다. fn이 같은 객체를 돌려주면 변경 없음으로 본다.
 * - 저장은 변경 직후 차례로. 검증 오류가 있는 동안은 저장하지 않고 상태로 알린다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Show } from "@/model/schema";
import { checkShow, ShowSchema, type IssueCode } from "@/model/schema";
import { getShow, putShow } from "@/storage/showStore";
import { DEFAULT_CONSOLE_PROFILE } from "@/export/profile";

const HISTORY_LIMIT = 300;

type Doc = { past: Show[]; present: Show; future: Show[] };

export type SaveStatus =
  | { kind: "saved"; at: string | null }
  | { kind: "pending" }
  | { kind: "invalid"; count: number }
  | { kind: "error"; message: string };

export type ValidationIssue = { path: PropertyKey[]; message: string; code?: IssueCode };

export function useShowDoc(id: string) {
  const [doc, setDoc] = useState<Doc | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved", at: null });
  const savedRef = useRef<Show | null>(null);

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
    const c = checkShow(present, { nameMax: DEFAULT_CONSOLE_PROFILE.nameMax });
    // 구조 오류(zod) + 점검 오류(코드 포함). 점검 오류는 superRefine으로도 들어오므로 custom은 빼고 합친다.
    const structural = r.success ? [] : r.error.issues.filter((i) => i.code !== "custom").map((i) => ({ path: i.path, message: i.message }));
    return {
      errors: [...structural, ...c.errors] as ValidationIssue[],
      warnings: c.warnings as ValidationIssue[],
    };
  }, [present]);

  const latest = useRef({ present, valid: true });
  useEffect(() => {
    latest.current = { present, valid: errors.length === 0 };
  }, [present, errors]);

  /**
   * 저장 펌프: 최신 상태가 저장될 때까지 차례로 저장한다 (동시에 두 번 쓰지 않음).
   * 변경 직후 바로 부르므로, 빠르게 입력하다 곧바로 창을 닫거나 새로고침해도 잃는 것이 거의 없다.
   */
  const saving = useRef(false);
  const pump = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      for (;;) {
        const { present: p, valid } = latest.current;
        if (!p || !valid || p === savedRef.current) break;
        await putShow(p);
        savedRef.current = p;
      }
      if (latest.current.present === savedRef.current)
        setStatus({ kind: "saved", at: new Date().toLocaleTimeString("ko-KR") });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    } finally {
      saving.current = false;
    }
  }, []);

  // 자동 저장. 검증 오류(저장 차단)가 있으면 상태로만 알린다.
  useEffect(() => {
    if (!present || present === savedRef.current) return;
    if (errors.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus({ kind: "invalid", count: errors.length });
      return;
    }
    setStatus({ kind: "pending" });
    void pump();
  }, [present, errors, pump]);

  // 페이지를 떠날 때: 남은 것이 있으면 저장, 오류 때문에 저장 못 한 변경이 있으면 경고
  useEffect(() => {
    const unsaved = () => {
      const { present: p } = latest.current;
      return p !== null && p !== savedRef.current;
    };
    const flush = () => {
      if (unsaved() && latest.current.valid) void pump();
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
  }, [pump]);

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
