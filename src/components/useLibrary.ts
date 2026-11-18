"use client";

/** 내 라이브러리 불러오기 + 변경 직후 자동 저장 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Library } from "@/model/library";
import { loadLibrary, saveLibrary } from "@/storage/libraryStore";

export function useLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<Library | null>(null);
  const latest = useRef<Library | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    loadLibrary().then(
      (lib) => {
        saved.current = lib;
        setLibrary(lib);
      },
      (e) => setError(String(e)),
    );
  }, []);

  /** 최신 상태가 저장될 때까지 차례로 저장 (동시에 두 번 쓰지 않음) */
  const pump = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (latest.current && latest.current !== saved.current) {
        const lib = latest.current;
        await saveLibrary(lib);
        saved.current = lib;
      }
    } catch (e) {
      setError(String(e));
    } finally {
      saving.current = false;
    }
  }, []);

  useEffect(() => {
    latest.current = library;
    if (library && library !== saved.current) void pump();
  }, [library, pump]);

  useEffect(() => {
    const flush = () => void pump();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [pump]);

  const update = useCallback((fn: (l: Library) => Library) => {
    setLibrary((l) => (l ? fn(l) : l));
  }, []);

  return { library, error, update };
}
