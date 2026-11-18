/** 저장하지 않고 Show에서 계산하는 값들 (같은 정보를 두 번 입력하지 않기 위해) */
import type { InputChannel, Show } from "./schema";

/** 기종 중립 화면 경고 기준. 실제 콘솔 제한은 내보내기 모듈이 따로 가진다. */
export const SHORT_NAME_WARN_LENGTH = 8;

export function micName(show: Show, ch: InputChannel): string {
  if (!ch.mic) return "";
  if (ch.mic.kind === "custom") return ch.mic.name;
  const id = ch.mic.microphoneId;
  return show.microphones.find((m) => m.id === id)?.model ?? "?";
}

/** 채널 값이 있으면 그것, 없으면 마이크 기본값 */
export function resolvePhantom(show: Show, ch: InputChannel): boolean {
  if (ch.phantom !== null) return ch.phantom;
  if (ch.mic?.kind !== "library") return false;
  const id = ch.mic.microphoneId;
  return show.microphones.find((m) => m.id === id)?.needsPhantom ?? false;
}

export function resolveStand(show: Show, ch: InputChannel): string {
  if (ch.stand !== null) return ch.stand;
  if (ch.mic?.kind !== "library") return "";
  const id = ch.mic.microphoneId;
  return show.microphones.find((m) => m.id === id)?.defaultStand ?? "";
}

/** 48V를 마이크 기본값에 맡겼는데 그 마이크의 48V 사양이 미확인인 경우 */
export function phantomUnknown(show: Show, ch: InputChannel): boolean {
  if (ch.phantom !== null || ch.mic?.kind !== "library") return false;
  const id = ch.mic.microphoneId;
  return show.microphones.find((m) => m.id === id)?.needsPhantom === null;
}
