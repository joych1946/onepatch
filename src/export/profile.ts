/**
 * 콘솔 프로필: 기종마다 다른 값(이름 글자 수, 채널·버스 수, 컬러·아이콘 목록)을 설정 데이터로 모은 곳.
 * 다른 기종을 추가할 때는 CONSOLE_PROFILES에 항목을 늘린다. 쇼 파일의 형식(위치·소스 번호)은
 * 여기 두지 않고 기종별 내보내기 모듈(src/export/dm7 …)이 파일 안 스키마로 계산한다.
 *
 * 데이터 모델은 기종 중립이다: OnePatch 컬러(Color)·소스 목록 id를 콘솔 값으로 바꾸는 표가 여기 있다.
 */
import type { Color } from "@/model/schema";

export interface ConsoleColor {
  /** 쇼 파일에 쓰는 값 */
  value: string;
  /** 화면 표시 */
  label: string;
  /** 화면의 색 견본 */
  hex: string;
}

export interface ConsoleProfile {
  id: string;
  name: string;
  /** 쇼 파일 머리말의 기종 표시 (같은 내보내기 모듈 안에서 기종을 고를 때) */
  modelCode: string;
  /** 채널·버스·DCA·뮤트 그룹 이름 최대 글자 수 */
  nameMax: number;
  inputs: number;
  /** Aux에 해당하는 버스(Mix) 수 — 스테레오는 2개를 쓴다 */
  mixes: number;
  matrices: number;
  /** Main에 해당하는 스테레오 버스 수 */
  mains: number;
  dcas: number;
  muteGroups: number;
  colors: ConsoleColor[];
  /** OnePatch 컬러 → 콘솔 컬러 값. approx면 콘솔에 같은 색이 없어 가까운 색으로 바꾼 것 */
  colorMap: Record<Exclude<Color, "none">, { value: string; approx?: boolean }>;
  /** 쓸 수 있는 아이콘 (실제 파일에서 관찰한 이름만) */
  icons: string[];
  /** 맞는 아이콘이 없을 때 */
  iconBlank: string;
  /** 기본 소스 목록 id → 아이콘 */
  iconBySource: Record<string, string>;
  /** 기본 악기군 id → 아이콘 (소스 단위 지정이 없을 때) */
  iconByGroup: Record<string, string>;
  /** 소스 목록에 없는 채널: 소스명·짧은 이름에 대한 규칙 (위에서부터, 정규식 문자열은 대소문자 무시) */
  iconRules: [pattern: string, icon: string][];
  /** 보컬로 보는 이름 (마이크가 무선이면 iconWireless, 아니면 iconVocal) */
  vocalPattern: string;
  iconVocal: string;
  iconWireless: string;
}

/* Yamaha DM7 시리즈 — docs/research/dm7.md (컬러 3절, 아이콘 3절 "파일에서 관찰") */
const DM7_COLORS: ConsoleColor[] = [
  { value: "Red", label: "Red", hex: "#e5483f" },
  { value: "Orange", label: "Orange", hex: "#f08a24" },
  { value: "Yellow", label: "Yellow", hex: "#e8c822" },
  { value: "Green", label: "Green", hex: "#2fa84f" },
  { value: "LtGreen", label: "LtGreen", hex: "#8fd14f" },
  { value: "SkyBlue", label: "SkyBlue", hex: "#3fb5e5" },
  { value: "Blue", label: "Blue", hex: "#3a64d8" },
  { value: "Purple", label: "Purple", hex: "#8d4fd1" },
  { value: "Pink", label: "Pink", hex: "#e05aa8" },
  { value: "White", label: "White", hex: "#e8e8e8" },
];

const DM7_ICONS = [
  "Kick", "Snare", "Hi-Hat", "Tom", "F.Tom", "Cymbal", "A.Bass", "E.Bass", "BassAmp", "A.Guitar", "E.Guitar", "GuitarAmp",
  "Keyboard", "Piano", "Strings", "Media1", "Wireless", "Dynamic", "Podium", "Wedge", "In-Ears", "Blank",
];

const DM7_BASE = {
  nameMax: 8,
  mixes: 48,
  matrices: 12,
  mains: 2,
  dcas: 24,
  muteGroups: 12,
  colors: DM7_COLORS,
  colorMap: {
    red: { value: "Red" },
    orange: { value: "Orange" },
    yellow: { value: "Yellow" },
    green: { value: "Green" },
    cyan: { value: "SkyBlue" },
    blue: { value: "Blue" },
    purple: { value: "Purple" },
    white: { value: "White" },
    pink: { value: "Pink" },
    lime: { value: "LtGreen" },
    brown: { value: "Orange", approx: true },
    gray: { value: "White", approx: true },
  },
  icons: DM7_ICONS,
  iconBlank: "Blank",
  iconBySource: {
    "src-kick-in": "Kick",
    "src-kick-out": "Kick",
    "src-snare-top": "Snare",
    "src-snare-btm": "Snare",
    "src-hihat": "Hi-Hat",
    "src-tom1": "Tom",
    "src-tom2": "Tom",
    "src-tom3": "Tom",
    "src-ftom": "F.Tom",
    "src-oh": "Cymbal",
    "src-ride": "Cymbal",
    "src-bass-di": "E.Bass",
    "src-bass-mic": "BassAmp",
    "src-egtr1": "GuitarAmp",
    "src-egtr2": "GuitarAmp",
    "src-agtr-di": "A.Guitar",
    "src-agtr-mic": "A.Guitar",
    "src-keys": "Keyboard",
    "src-synth": "Keyboard",
    "src-piano": "Piano",
    "src-cb": "A.Bass",
    "src-mr": "Media1",
    "src-tb-mic": "Dynamic",
    "src-kkwaenggwari": "Cymbal",
    "src-jing": "Cymbal",
  },
  iconByGroup: {
    "grp-strings": "Strings",
    "grp-gugak-str": "Strings",
  },
  iconRules: [
    ["kick|킥|\\bbd\\b|bass ?drum", "Kick"],
    ["snare|스네어|\\bsn\\b", "Snare"],
    ["hi-?hat|하이햇|\\bhh\\b", "Hi-Hat"],
    ["floor|f\\.? ?tom|플로어", "F.Tom"],
    ["tom|탐", "Tom"],
    ["\\boh\\b|overhead|오버헤드|cymbal|ride|crash|심벌", "Cymbal"],
    ["contra|upright|콘트라", "A.Bass"],
    ["bass ?(amp|mic|cab)|베이스 ?(앰프|마이크)", "BassAmp"],
    ["bass|베이스", "E.Bass"],
    ["a\\.? ?g(ui)?tr|ac\\.? ?g(ui)?tr|acoustic|어쿠스틱|통기타", "A.Guitar"],
    ["g(ui)?tr|guitar|기타", "E.Guitar"],
    ["piano|피아노", "Piano"],
    ["key|synth|organ|건반|신스", "Keyboard"],
    ["violin|viola|cello|string|바이올린|비올라|첼로|현악", "Strings"],
    ["\\bmr\\b|track|playback|mtr|laptop|\\bpc\\b|반주", "Media1"],
    ["podium|lectern|연설|연단", "Podium"],
    ["talk ?back|\\btb\\b|토크백", "Dynamic"],
  ],
  vocalPattern: "vocal|\\bvox\\b|\\bvo\\b|voice|chorus|\\bcho\\b|\\bmc\\b|보컬|사회|코러스|소리|민요|정가|추임새",
  iconVocal: "Dynamic",
  iconWireless: "Wireless",
} satisfies Omit<ConsoleProfile, "id" | "name" | "modelCode" | "inputs">;

export const CONSOLE_PROFILES: ConsoleProfile[] = [
  { id: "dm7c", name: "Yamaha DM7 Compact", modelCode: "DM7C", inputs: 72, ...DM7_BASE },
  { id: "dm7", name: "Yamaha DM7", modelCode: "DM7", inputs: 120, ...DM7_BASE },
];

/** 주력 콘솔 (CLAUDE.md [내 환경]) — 오류 검사의 이름 글자 수 등 기본 기준 */
export const DEFAULT_CONSOLE_PROFILE: ConsoleProfile = CONSOLE_PROFILES[0];

export function profileByModel(modelCode: string): ConsoleProfile {
  return CONSOLE_PROFILES.find((p) => p.modelCode === modelCode) ?? DEFAULT_CONSOLE_PROFILE;
}

/** OnePatch 컬러 → 콘솔 컬러 (사용자가 바꾼 대응이 있으면 그것) */
export function consoleColor(profile: ConsoleProfile, color: Color, overrides?: Partial<Record<Color, string>>): { value: string; approx: boolean } | null {
  if (color === "none") return null;
  const o = overrides?.[color];
  if (o && profile.colors.some((c) => c.value === o)) return { value: o, approx: false };
  const m = profile.colorMap[color];
  return { value: m.value, approx: !!m.approx };
}
