/**
 * 크루 화면 역할 필터 (의존성 없음 — 크루 화면을 가볍게 유지하려고 share.ts와 나눔).
 * 무대: 패치·마이크·스탠드 / 모니터: Aux·IEM / FOH: 전체
 */
export type ShareRole = "stage" | "monitor" | "foh";

export const SHARE_ROLES: { key: ShareRole; label: string; note: string }[] = [
  { key: "stage", label: "무대", note: "패치·마이크·스탠드" },
  { key: "monitor", label: "모니터", note: "Aux·IEM" },
  { key: "foh", label: "FOH", note: "전체" },
];

/** 역할별 인풋 칸 (첫 줄은 늘 Ch·소스) */
export const ROLE_INPUT_FIELDS: Record<ShareRole, string[]> = {
  stage: ["port", "mic", "stand", "phantom", "link", "notes"],
  monitor: ["shortName", "link", "performer", "notes"],
  foh: ["shortName", "mic", "stand", "phantom", "port", "link", "color", "dca", "mute", "notes"],
};

/** 역할별 아웃풋: 무대는 물리 출력이 있는 것(웨지 등 배선), 모니터는 Aux, FOH는 전체 */
export const ROLE_OUTPUT_FIELDS: Record<ShareRole, string[]> = {
  stage: ["ports", "notes"],
  monitor: ["width", "tap", "ports", "notes"],
  foh: ["purpose", "width", "tap", "sources", "ports", "notes"],
};
