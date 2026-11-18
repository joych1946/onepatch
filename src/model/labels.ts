/** 화면 표시용 한국어/현장 용어 라벨. 데이터에는 영문 키만 저장한다. */
import type { BusKind, BusPurpose, Color, MicType, PortRef, StageBox } from "./schema";

export const MIC_TYPE_LABEL: Record<MicType, string> = {
  dynamic: "다이내믹",
  condenser: "콘덴서",
  ribbon: "리본",
  di: "DI",
  wireless: "무선",
};

export const BUS_KIND_LABEL: Record<BusKind, string> = {
  aux: "Aux",
  matrix: "Matrix",
  main: "Main",
};

export const BUS_PURPOSE_LABEL: Record<BusPurpose, string> = {
  wedge: "웨지",
  iem: "IEM",
  sidefill: "사이드필",
  fx: "FX",
  pa: "메인 PA",
  sub: "서브",
  frontfill: "프런트필",
  delay: "딜레이",
  record: "녹음",
  broadcast: "중계",
  other: "기타",
};

export const COLOR_LABEL: Record<Color, string> = {
  none: "없음",
  red: "빨강",
  orange: "주황",
  yellow: "노랑",
  green: "초록",
  cyan: "하늘",
  blue: "파랑",
  purple: "보라",
  white: "흰색",
  pink: "분홍",
  lime: "연두",
  brown: "갈색",
  gray: "회색",
};

/** 화면 표시용 색상 값 (콘솔 색상과는 무관) */
export const COLOR_SWATCH: Record<Color, string> = {
  none: "transparent",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  cyan: "#22d3ee",
  blue: "#3b82f6",
  purple: "#a855f7",
  white: "#f5f5f5",
  pink: "#f472b6",
  lime: "#a3e635",
  brown: "#a16207",
  gray: "#9ca3af",
};

export function formatPort(port: PortRef | null, boxes: StageBox[]): string {
  if (!port) return "—";
  switch (port.kind) {
    case "stagebox": {
      const box = boxes.find((b) => b.id === port.stageBoxId);
      return `${box?.name ?? "?"} ${port.port}`;
    }
    case "local":
      return `Local ${port.port}`;
    case "other":
      return port.label || "기타";
  }
}
