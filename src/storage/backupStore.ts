/**
 * 전체 백업용 저장소 읽기/쓰기 (Show 전부, 내 라이브러리, 콘솔 기준 파일).
 * 계산(형식·합치기)은 src/model/backup.ts.
 */
import { parseShow } from "@/model/serialize";
import { LibrarySchema } from "@/model/library";
import type { AppData } from "@/model/backup";
import { CONSOLE_FILES, db, LIBRARY, SHARES, SHOWS, VERSION_DATA, VERSIONS } from "./db";
import type { ShareLinkData } from "@/model/backup";
import type { VersionMeta } from "@/model/versions";
import type { ConsoleBaseFile } from "./consoleFileStore";

const LIB_KEY = "user";

export async function readAppData(): Promise<AppData> {
  const d = await db();
  const shows = ((await d.getAll(SHOWS)) as unknown[]).map(parseShow).flatMap((r) => (r.ok ? [r.show] : []));
  const rawLib = await d.get(LIBRARY, LIB_KEY);
  const lib = LibrarySchema.safeParse(rawLib);
  const keys = (await d.getAllKeys(CONSOLE_FILES)) as string[];
  const consoleFiles = [];
  for (const key of keys) {
    const f = (await d.get(CONSOLE_FILES, key)) as ConsoleBaseFile | undefined;
    if (f?.bytes instanceof Uint8Array) consoleFiles.push({ key, name: f.name, uploadedAt: f.uploadedAt, bytes: f.bytes });
  }
  const versions = [];
  for (const meta of (await d.getAll(VERSIONS)) as VersionMeta[]) {
    const r = parseShow(await d.get(VERSION_DATA, meta.id));
    if (r.ok) versions.push({ meta, show: r.show });
  }
  const shares = ((await d.getAll(SHARES)) as ShareLinkData[]).filter((s) => parseShow(s.lastPublished).ok);
  return { shows, library: lib.success ? lib.data : null, consoleFiles, versions, shares };
}

/** 데이터 전체를 저장소에 쓴다. 데이터에 없는 Show·기준 파일은 지운다 (한 트랜잭션) */
export async function writeAppData(data: AppData): Promise<void> {
  const d = await db();
  const tx = d.transaction([SHOWS, LIBRARY, CONSOLE_FILES, VERSIONS, VERSION_DATA, SHARES], "readwrite");
  const shows = tx.objectStore(SHOWS);
  const keep = new Set(data.shows.map((s) => s.id));
  for (const id of (await shows.getAllKeys()) as string[]) if (!keep.has(id)) await shows.delete(id);
  for (const s of data.shows) await shows.put(s);
  if (data.library) await tx.objectStore(LIBRARY).put(LibrarySchema.parse(data.library), LIB_KEY);
  const files = tx.objectStore(CONSOLE_FILES);
  const keepKeys = new Set(data.consoleFiles.map((f) => f.key));
  for (const k of (await files.getAllKeys()) as string[]) if (!keepKeys.has(k)) await files.delete(k);
  for (const f of data.consoleFiles) await files.put({ name: f.name, bytes: f.bytes, uploadedAt: f.uploadedAt } satisfies ConsoleBaseFile, f.key);
  if (data.shares) {
    const st = tx.objectStore(SHARES);
    const keepS = new Set(data.shares.map((s) => s.showId));
    for (const k of (await st.getAllKeys()) as string[]) if (!keepS.has(k)) await st.delete(k);
    for (const s of data.shares) await st.put(s);
  }
  if (data.versions) {
    const metas = tx.objectStore(VERSIONS);
    const vdata = tx.objectStore(VERSION_DATA);
    const keepV = new Set(data.versions.map((v) => v.meta.id));
    for (const id of (await metas.getAllKeys()) as string[])
      if (!keepV.has(id)) {
        await metas.delete(id);
        await vdata.delete(id);
      }
    for (const v of data.versions) {
      await metas.put(v.meta);
      await vdata.put(v.show, v.meta.id);
    }
  }
  await tx.done;
}
