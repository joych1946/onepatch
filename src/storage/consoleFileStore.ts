/**
 * 콘솔 내보내기의 기준 쇼 파일 보관 (IndexedDB consoleFiles, 키 = 기종 모듈 "dm7").
 * 한 번 올리면 다음 내보내기부터 다시 올리지 않아도 된다. 원본 바이트를 그대로 보관한다.
 */
import { CONSOLE_FILES, db } from "./db";

export interface ConsoleBaseFile {
  /** 올린 파일 이름 */
  name: string;
  bytes: Uint8Array;
  /** 올린 시각 (ISO) */
  uploadedAt: string;
}

export async function getConsoleBase(key: string): Promise<ConsoleBaseFile | null> {
  const v = (await (await db()).get(CONSOLE_FILES, key)) as ConsoleBaseFile | undefined;
  if (!v || typeof v.name !== "string" || !(v.bytes instanceof Uint8Array)) return null;
  return v;
}

export async function putConsoleBase(key: string, file: ConsoleBaseFile): Promise<void> {
  await (await db()).put(CONSOLE_FILES, file, key);
}

export async function deleteConsoleBase(key: string): Promise<void> {
  await (await db()).delete(CONSOLE_FILES, key);
}
