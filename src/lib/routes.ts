/**
 * 화면 주소. Show id는 경로가 아니라 쿼리(?id=)에 둔다 — 그래야 페이지가 고정 파일이 되어
 * 오프라인용으로 미리 저장할 수 있다(public/sw.js). 예전 주소 /shows/[id]/…는 여기로 넘긴다.
 */
export const routes = {
  list: "/",
  library: "/library",
  show: (id: string) => `/show?id=${encodeURIComponent(id)}`,
  print: (id: string) => `/show/print?id=${encodeURIComponent(id)}`,
  console: (id: string) => `/show/console?id=${encodeURIComponent(id)}`,
  versions: (id: string) => `/show/versions?id=${encodeURIComponent(id)}`,
};

/** 오프라인용으로 미리 저장할 페이지 (쿼리 없이) */
export const APP_PAGES = ["/", "/library", "/show", "/show/print", "/show/console", "/show/versions"];
