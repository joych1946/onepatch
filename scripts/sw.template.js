/*
 * OnePatch 서비스 워커 — 오프라인 사용 (scripts/build-sw.mjs가 빌드 때 public/sw.js로 만든다. 직접 고치지 말 것)
 * - 설치: 앱 페이지와 그 페이지가 쓰는 /_next/static 파일을 모두 미리 저장
 * - 페이지 이동: 네트워크 먼저, 안 되면 저장본 (?id= 같은 쿼리는 무시하고 같은 페이지)
 * - /_next/static: 저장본 먼저 (파일 이름에 해시가 있어 바뀌지 않음)
 * - 새 버전: 기다리다가 화면의 "새로고침"을 누르면(SKIP_WAITING) 바뀐다
 */
const VERSION = "__VERSION__";
const PAGES = __PAGES__;
const CACHE = `onepatch-${VERSION}`;
const STATIC_RE = /\/_next\/static\/[^"'\s\\)<>]+/g;

async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set(["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-icon.png", "/favicon.ico"]);
  for (const page of PAGES) {
    const res = await fetch(page, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) throw new Error(`precache ${page}: ${res.status}`);
    const html = await res.clone().text();
    for (const m of html.match(STATIC_RE) ?? []) assets.add(m);
    await cache.put(page, res);
  }
  await Promise.all(
    [...assets].map(async (url) => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (res.ok) await cache.put(url, res);
      } catch {
        /* 없는 파일은 건너뜀 */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("onepatch-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "VERSION") event.source?.postMessage({ version: VERSION });
});

const pageKey = (url) => (PAGES.includes(url.pathname) ? url.pathname : url.pathname.replace(/\/$/, "") || "/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 서버 API(크루 공유 등)는 늘 네트워크로 — 오프라인 처리는 화면이 한다(마지막 받은 내용)
  if (url.pathname.startsWith("/api/")) return;

  // 페이지 이동
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok && PAGES.includes(url.pathname)) await cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (await cache.match(pageKey(url))) ?? (await cache.match("/")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // 화면 이동 중 서버 컴포넌트 요청(RSC): 오프라인이면 실패시켜 Next가 페이지 이동으로 바꾸게 한다
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  // 바뀌지 않는 빌드 파일
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // 아이콘·매니페스트 등: 저장본을 주고 뒤에서 갱신
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then(async (res) => {
          if (res.ok) await cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return hit ?? (await net) ?? Response.error();
    })(),
  );
});
