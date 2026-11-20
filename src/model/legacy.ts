/**
 * 예전 저장본의 값을 새 표기로 바꾸기. 스키마의 필드 변환에서 쓰므로
 * Show·내 라이브러리·템플릿·버전·백업·공유본을 읽을 때 모두 자동으로 적용된다.
 */

/** 스탠드 표기 (현장 용어): 예전 이름 → 새 이름. 목록에 없는 이름은 그대로 둔다. */
export const STAND_RENAME: Readonly<Record<string, string>> = {
  톨붐: "롱T",
  숏붐: "숏T",
};

/** 기본 스탠드 이름 (선택 목록 순서) */
export const STAND_NAMES = ["롱T", "숏T", "스트레이트", "클램프"] as const;

export function renameStand(stand: string): string {
  return STAND_RENAME[stand.trim()] ?? stand;
}
