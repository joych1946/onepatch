/**
 * 버전 저장소. 목록(VERSIONS: 이름·시각·지문)과 내용(VERSION_DATA: Show 스냅샷)을 나눠,
 * 버전이 많아도 Show 열기·버전 목록이 느려지지 않게 한다. 계산은 src/model/versions.ts.
 */
import type { Show } from "@/model/schema";
import { parseShow } from "@/model/serialize";
import { newId } from "@/model/factory";
import { metaOf, type VersionMeta } from "@/model/versions";
import { db, VERSION_DATA, VERSIONS } from "./db";

/** 최근 것이 앞 */
export async function listVersions(showId: string): Promise<VersionMeta[]> {
  const list = (await (await db()).getAllFromIndex(VERSIONS, "showId", showId)) as VersionMeta[];
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getVersionShow(id: string): Promise<Show> {
  const raw = await (await db()).get(VERSION_DATA, id);
  const r = parseShow(raw);
  if (!r.ok) throw new Error(`버전 내용을 읽지 못했습니다:\n${r.errors.join("\n")}`);
  return r.show;
}

export async function saveVersion(show: Show, name: string, createdAt?: string): Promise<VersionMeta> {
  const r = parseShow(show);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  const meta = metaOf(newId(), name.trim() || "이름 없는 버전", r.show, createdAt);
  const tx = (await db()).transaction([VERSIONS, VERSION_DATA], "readwrite");
  await tx.objectStore(VERSIONS).put(meta);
  await tx.objectStore(VERSION_DATA).put(r.show, meta.id);
  await tx.done;
  return meta;
}

export async function deleteVersion(id: string): Promise<void> {
  const tx = (await db()).transaction([VERSIONS, VERSION_DATA], "readwrite");
  await tx.objectStore(VERSIONS).delete(id);
  await tx.objectStore(VERSION_DATA).delete(id);
  await tx.done;
}

export async function deleteVersionsOf(showId: string): Promise<void> {
  for (const v of await listVersions(showId)) await deleteVersion(v.id);
}
