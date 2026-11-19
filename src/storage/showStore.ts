/**
 * 브라우저 로컬 저장소(IndexedDB). Show 하나 = 레코드 하나.
 * 읽을 때도 스키마 검증을 거쳐, 손상된 레코드가 화면까지 오지 않게 한다.
 */
import { parseShow } from "@/model/serialize";
import type { Show } from "@/model/schema";
import { db, SHOWS as STORE } from "./db";
import { deleteVersionsOf } from "./versionStore";

export type ShowSummary = Pick<
  Show,
  "id" | "title" | "date" | "venue" | "version" | "updatedAt"
> & { inputCount: number; outputCount: number };

export async function listShows(): Promise<ShowSummary[]> {
  const all: unknown[] = await (await db()).getAll(STORE);
  return all
    .map((raw) => parseShow(raw))
    .flatMap((r) => (r.ok ? [r.show] : []))
    .map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date,
      venue: s.venue,
      version: s.version,
      updatedAt: s.updatedAt,
      inputCount: s.inputs.length,
      outputCount: s.outputs.length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getShow(id: string): Promise<Show | null> {
  const raw: unknown = await (await db()).get(STORE, id);
  if (raw === undefined) return null;
  const r = parseShow(raw);
  if (!r.ok) throw new Error(`저장된 Show가 손상되었습니다:\n${r.errors.join("\n")}`);
  return r.show;
}

/** 검증 후 저장. updatedAt은 호출하는 쪽이 정한다(가져오기는 원본 값 유지). */
export async function putShow(show: Show): Promise<void> {
  const r = parseShow(show);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  await (await db()).put(STORE, r.show);
}

export async function deleteShow(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
  await deleteVersionsOf(id); // 그 Show의 버전도 함께
}
