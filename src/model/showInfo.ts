/**
 * 공연 정보(공연명·날짜·장소·작성자·버전·메모) 편집 계산. 화면은 src/components/ShowInfo.tsx.
 */
import type { Show } from "./schema";

export type ShowInfo = Pick<Show, "title" | "date" | "venue" | "author" | "version" | "notes">;
export const SHOW_INFO_KEYS = ["title", "date", "venue", "author", "version", "notes"] as const;

export function showInfoOf(show: Show): ShowInfo {
  return { title: show.title, date: show.date, venue: show.venue, author: show.author, version: show.version, notes: show.notes };
}

/** YYYY-MM-DD이고 실제 있는 날짜인지 */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 앞뒤 공백 정리 (메모는 줄바꿈을 살리고 끝 공백만) */
export function normalizeShowInfo(info: ShowInfo): ShowInfo {
  return {
    title: info.title.trim(),
    date: info.date.trim(),
    venue: info.venue.trim(),
    author: info.author.trim(),
    version: info.version.trim(),
    notes: info.notes.replace(/\s+$/, ""),
  };
}

/** 저장할 수 없는 이유 (없으면 빈 배열) */
export function showInfoProblems(info: ShowInfo): { field: keyof ShowInfo; message: string }[] {
  const n = normalizeShowInfo(info);
  const out: { field: keyof ShowInfo; message: string }[] = [];
  if (!n.title) out.push({ field: "title", message: "공연명을 입력하세요." });
  if (n.date && !isIsoDate(n.date)) out.push({ field: "date", message: "날짜는 YYYY-MM-DD 형식이거나 비워 두세요." });
  return out;
}

/**
 * 공연 정보를 바꾼 Show. 문제가 있거나 바뀐 것이 없으면 같은 객체를 돌려준다
 * (useShowDoc.apply가 같은 객체면 변경 없음으로 보고 실행 취소 기록도 남기지 않음).
 */
export function applyShowInfo(show: Show, patch: Partial<ShowInfo>): Show {
  const next = normalizeShowInfo({ ...showInfoOf(show), ...patch });
  if (showInfoProblems(next).length) return show;
  if (SHOW_INFO_KEYS.every((k) => show[k] === next[k])) return show;
  return { ...show, ...next };
}

/** 템플릿으로 새 Show를 만들고 열 때 공연명 입력 상태로 시작하라는 표시 (sessionStorage, 값 = Show id) */
export const EDIT_TITLE_KEY = "onepatch.editTitle";

/** 브라우저 탭 제목 */
export function showDocumentTitle(show: Pick<Show, "title">, page?: string): string {
  return [show.title, page, "OnePatch"].filter(Boolean).join(" — ");
}
