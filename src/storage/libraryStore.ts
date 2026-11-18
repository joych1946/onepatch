/** 내 라이브러리 저장 — 레코드 하나("user"). 처음 열면 기본값을 넣는다. */
import { LibrarySchema, type Library } from "@/model/library";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { db, LIBRARY } from "./db";

const KEY = "user";

export async function loadLibrary(): Promise<Library> {
  const raw: unknown = await (await db()).get(LIBRARY, KEY);
  if (raw === undefined) {
    const lib = createDefaultLibrary();
    await saveLibrary(lib);
    return lib;
  }
  const r = LibrarySchema.safeParse(raw);
  if (r.success) return r.data;
  // 형식이 맞지 않으면 원본을 따로 보관하고 기본값으로 다시 시작한다 (원본은 지우지 않음)
  console.warn("OnePatch: 저장된 라이브러리 형식이 맞지 않아 기본값으로 시작합니다. 원본은 백업해 둡니다.", r.error.issues);
  await (await db()).put(LIBRARY, raw, `${KEY}-backup-${Date.now()}`);
  const lib = createDefaultLibrary();
  await saveLibrary(lib);
  return lib;
}

export async function saveLibrary(lib: Library): Promise<void> {
  await (await db()).put(LIBRARY, LibrarySchema.parse(lib), KEY);
}
