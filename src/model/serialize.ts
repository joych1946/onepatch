/** Show ↔ JSON 파일. 가져올 때는 반드시 스키마 + 참조 무결성 검증을 거친다. */
import { ShowSchema, type Show } from "./schema";

export function showToJson(show: Show): string {
  return JSON.stringify(show, null, 2);
}

export type ParseResult =
  | { ok: true; show: Show }
  | { ok: false; errors: string[] };

export function parseShow(data: unknown): ParseResult {
  const result = ShowSchema.safeParse(data);
  if (result.success) return { ok: true, show: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".") || "(전체)"}: ${i.message}`,
    ),
  };
}

export function parseShowJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON 형식이 아닙니다."] };
  }
  return parseShow(data);
}

/** 파일명: 2026-12-24_공연명_v3.json */
export function showFileName(show: Show): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
  return (
    [show.date, safe(show.title) || "show", safe(show.version)]
      .filter(Boolean)
      .join("_") + ".json"
  );
}
