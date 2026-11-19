import type { Show } from "@/model/schema";
import { fileBase } from "@/lib/showExport";

/** 내려받을 DM7 쇼 파일 이름: 공연 날짜_공연명_DM7_버전 + 올린 파일의 확장자(.dmxf / .dm7f) */
export function dm7FileName(show: Show, uploaded: string): string {
  const ext = uploaded.match(/\.(dmxf|dm7f)$/i)?.[0] ?? ".dmxf";
  return `${fileBase(show, "DM7")}${ext}`;
}
