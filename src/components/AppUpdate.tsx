"use client";

/**
 * 오프라인 사용: 서비스 워커(/sw.js) 등록, 새 버전 안내, 오프라인 표시.
 * 개발 중(next dev)에는 등록하지 않는다 (빌드한 앱에서만 /sw.js가 있다).
 */
import { useEffect, useState } from "react";

/** 사용자가 "새로고침"을 눌렀을 때만 새 워커로 바뀐 뒤 다시 읽는다 (첫 설치 때 claim으로 바뀌는 것은 무시) */
let userAskedReload = false;

export default function AppUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading || !userAskedReload) return;
      reloading = true;
      location.reload();
    };
    const track = (r: ServiceWorkerRegistration) => {
      // 이미 앱을 쓰고 있을 때(controller가 있을 때) 새 워커가 준비되면 안내한다. 첫 설치는 안내하지 않음.
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    };
    const check = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void reg?.update().catch(() => {});
    };
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((r) => {
      reg = r;
      track(r);
    }, () => {});
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, []);

  if (!waiting && !offline) return null;
  return (
    <div className="no-print fixed right-3 bottom-3 z-[60] flex flex-col items-end gap-2 text-sm">
      {offline && (
        <div role="status" className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 shadow dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          오프라인 — 편집·인쇄·내보내기는 그대로 됩니다
        </div>
      )}
      {waiting && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-blue-500 bg-white px-4 py-2 shadow-lg dark:bg-neutral-900">
          <span>새 버전이 있습니다.</span>
          <button className="rounded border border-blue-500 px-3 py-1 font-medium text-blue-700 dark:text-blue-300" onClick={() => {
              userAskedReload = true;
              waiting.postMessage("SKIP_WAITING");
            }}>
            새로고침
          </button>
        </div>
      )}
    </div>
  );
}
