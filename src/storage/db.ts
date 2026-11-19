/** IndexedDB 연결 (Show 목록 + 내 라이브러리 + 콘솔 기준 파일) */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "onepatch";
export const SHOWS = "shows";
export const LIBRARY = "library";
/** 콘솔 내보내기의 기준 쇼 파일 (기종 모듈마다 하나, 키 = "dm7" …) */
export const CONSOLE_FILES = "consoleFiles";
/** 버전 목록(가벼운 정보, showId 색인)과 내용(Show 스냅샷)을 나눠 둔다 — Show 열기와 버전 목록이 내용을 읽지 않게 */
export const VERSIONS = "versions";
export const VERSION_DATA = "versionData";
/** 크루 공유 링크와 업데이트 키, 지난 공유본 (Show id별) */
export const SHARES = "shares";

let dbPromise: Promise<IDBPDatabase> | null = null;

export function db() {
  // v2: library 저장소 추가. v3: 개발 중 다른 형태로 만들어졌을 수 있는 library 저장소를 바로잡음. v4: consoleFiles. v5: versions. v6: shares
  dbPromise ??= openDB(DB_NAME, 6, {
    upgrade(d, _old, _new, tx) {
      if (!d.objectStoreNames.contains(SHOWS)) d.createObjectStore(SHOWS, { keyPath: "id" });
      // library는 키를 따로 주는(out-of-line) 저장소여야 한다
      if (d.objectStoreNames.contains(LIBRARY) && tx.objectStore(LIBRARY).keyPath !== null)
        d.deleteObjectStore(LIBRARY);
      if (!d.objectStoreNames.contains(LIBRARY)) d.createObjectStore(LIBRARY);
      if (!d.objectStoreNames.contains(CONSOLE_FILES)) d.createObjectStore(CONSOLE_FILES);
      if (!d.objectStoreNames.contains(VERSIONS)) d.createObjectStore(VERSIONS, { keyPath: "id" }).createIndex("showId", "showId");
      if (!d.objectStoreNames.contains(VERSION_DATA)) d.createObjectStore(VERSION_DATA);
      if (!d.objectStoreNames.contains(SHARES)) d.createObjectStore(SHARES, { keyPath: "showId" });
    },
    blocked() {
      console.warn("OnePatch: 다른 탭이 이전 버전 저장소를 열고 있어 업그레이드를 기다립니다. 다른 탭을 새로고침하세요.");
    },
    blocking() {
      // 새 버전이 열리려 하면 이 연결을 닫아 막지 않는다
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
  });
  return dbPromise;
}
