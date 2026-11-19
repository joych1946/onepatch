/**
 * 감독님 브라우저에 두는 크루 공유 정보 (Show마다): 공유 id, 업데이트 키, 지난 공유본(변경 표시 기준).
 * 키는 서버에 해시만 있으므로 잃으면 그 링크를 업데이트할 수 없다 → 전체 백업에 포함.
 */
import type { Show } from "@/model/schema";
import { db, SHARES } from "./db";

export interface ShareLink {
  showId: string;
  id: string;
  key: string;
  publishedAt: string;
  /** 지난 공유 때의 Show (다음 공유의 변경 표시 기준) */
  lastPublished: Show;
}

export async function getShareLink(showId: string): Promise<ShareLink | null> {
  return ((await (await db()).get(SHARES, showId)) as ShareLink | undefined) ?? null;
}
export async function putShareLink(link: ShareLink): Promise<void> {
  await (await db()).put(SHARES, link);
}
export async function deleteShareLink(showId: string): Promise<void> {
  await (await db()).delete(SHARES, showId);
}
export async function allShareLinks(): Promise<ShareLink[]> {
  return (await (await db()).getAll(SHARES)) as ShareLink[];
}
