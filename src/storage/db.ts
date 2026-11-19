/** IndexedDB 연결 (Show 목록 + 내 라이브러리 + 콘솔 기준 파일) */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "onepatch";
export const SHOWS = "shows";
export const LIBRARY = "library";
/** 콘솔 내보내기의 기준 쇼 파일 (기종 모듈마다 하나, 키 = "dm7" …) */
export const CONSOLE_FILES = "consoleFiles";

let dbPromise: Promise<IDBPDatabase> | null = null;

export function db() {
  // v2: library 저장소 추가. v3: 개발 중 다른 형태로 만들어졌을 수 있는 library 저장소를 바로잡음. v4: consoleFiles
  dbPromise ??= openDB(DB_NAME, 4, {
    upgrade(d, _old, _new, tx) {
      if (!d.objectStoreNames.contains(SHOWS)) d.createObjectStore(SHOWS, { keyPath: "id" });
      // library는 키를 따로 주는(out-of-line) 저장소여야 한다
      if (d.objectStoreNames.contains(LIBRARY) && tx.objectStore(LIBRARY).keyPath !== null)
        d.deleteObjectStore(LIBRARY);
      if (!d.objectStoreNames.contains(LIBRARY)) d.createObjectStore(LIBRARY);
      if (!d.objectStoreNames.contains(CONSOLE_FILES)) d.createObjectStore(CONSOLE_FILES);
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
