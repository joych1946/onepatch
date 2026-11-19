/**
 * 쇼 파일 머리말(ProjectInfo, MBDF)에서 기종과 저장 시각 읽기 — 위치는 머리말 안의 스키마로 계산한다.
 * 저장 시각은 UTC로 기록되어 있다 (DM Editor 저장 시각과 파일 시각 비교로 확인, docs/research/dm7.md 4.1).
 */
import type { Dm7File } from "./container";
import { locate, parseSections, readUint } from "./mbdf";
import { profileByModel } from "../profile";

export interface Dm7FileInfo {
  /** 기종 이름 (프로필) */
  modelName: string;
  /** 형식 버전 바이트 */
  formatVersion: string;
  /** 쇼 파일이 저장된 시각 (ISO, 읽지 못하면 null) */
  savedAt: string | null;
}

export function dm7FileInfo(file: Dm7File): Dm7FileInfo {
  let savedAt: string | null = null;
  try {
    const sec = parseSections(file.head)[0];
    const v = (k: string) => readUint(file.head, locate(sec, ["Info", "TimeStamp", k]));
    const [y, mo, d, h, mi, s] = ["Year", "Month", "Day", "Hour", "Minute", "Second"].map(v);
    if (y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) savedAt = new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString();
  } catch {
    savedAt = null;
  }
  return { modelName: profileByModel(file.model).name, formatVersion: file.formatVersion, savedAt };
}
