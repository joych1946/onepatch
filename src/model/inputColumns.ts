/**
 * 인풋리스트 그리드의 열 정의.
 * 각 열은 "화면/복사용 텍스트"와 "텍스트 → 데이터" 변환을 함께 가진다.
 * 키보드 입력과 엑셀 붙여넣기가 같은 변환을 쓰므로 결과가 항상 같다.
 */
import { micName, resolvePhantom, resolveStand } from "./derive";
import { newId } from "./factory";
import { updateChannel } from "./inputOps";
import { COLOR_LABEL, formatPort } from "./labels";
import type { Color, InputChannel, MicRef, PortRef, Show } from "./schema";
import { ensureShowMic, findMicByName, type LibraryMic } from "./library";
import { norm } from "./text";

/** 열 변환에 필요한 Show 밖의 정보 */
export interface ColCtx {
  /** 내 라이브러리의 마이크 (Show에 아직 없는 모델도 이름으로 고를 수 있게) */
  catalog?: LibraryMic[];
}

export type ColKey =
  | "ch"
  | "source"
  | "shortName"
  | "mic"
  | "stand"
  | "phantom"
  | "port"
  | "link"
  | "color"
  | "dca"
  | "notes";

export interface Column {
  key: ColKey;
  label: string;
  /** 엑셀 헤더 인식용 별칭 (normalizeHeader 적용 후 비교) */
  aliases: string[];
  /** 체크형 열: Enter/Space로 토글 */
  toggle?: boolean;
  /** 화면 표시 및 복사 텍스트 */
  text(show: Show, ch: InputChannel): string;
  /** Enter로 편집을 시작할 때의 초기 텍스트 */
  editText(show: Show, ch: InputChannel): string;
  /** 텍스트를 적용. 인식할 수 없는 값이면 null */
  set(show: Show, index: number, text: string, ctx?: ColCtx): Show | null;
  /** 편집 중 보여줄 후보 */
  suggestions?(show: Show, ctx?: ColCtx): string[];
}

/* ───────────── 파서 ───────────── */


const TRUE_RE = /^(y|yes|o|○|◯|●|v|✓|✔|1|true|on|48|48v|phantom|link|linked|st|stereo|↔.*|예|있음|켜기)$/;
const FALSE_RE = /^(n|no|x|×|-|—|0|false|off|아니오|없음|끄기)$/;

/** "" → null(기본값), 인식 불가 → undefined */
export function parseBool(text: string): boolean | null | undefined {
  const t = text.trim().toLowerCase().replace(/^\+/, "");
  if (t === "") return null;
  if (TRUE_RE.test(t)) return true;
  if (FALSE_RE.test(t)) return false;
  return undefined;
}

export function parseColor(text: string): Color | undefined {
  const t = text.trim().toLowerCase().replace(/색$/, "");
  if (t === "" || t === "-" || t === "none" || t === "없음") return "none";
  for (const [key, label] of Object.entries(COLOR_LABEL) as [Color, string][]) {
    if (t === key || t === label) return key;
  }
  const extra: Record<string, Color> = {
    빨간: "red", 적: "red", 주황색: "orange", 노란: "yellow", 황: "yellow",
    녹: "green", 초: "green", 청록: "cyan", 하늘색: "cyan", 파란: "blue", 청: "blue",
    보: "purple", 자주: "purple", 흰: "white", 백: "white",
    magenta: "pink", 핑크: "pink", 연두색: "lime", lightgreen: "lime", 밤색: "brown", 갈: "brown",
    grey: "gray", 회: "gray", 그레이: "gray", sky: "cyan", lightblue: "cyan",
  };
  return extra[t];
}

/**
 * 마이크 텍스트 → 참조. Show 안의 마이크를 먼저, 없으면 내 라이브러리(catalog)에서 찾는다.
 * 어디에도 없으면 자유 입력(custom).
 */
export function parseMic(show: Show, text: string, catalog: LibraryMic[] = []): MicRef | null {
  const t = text.trim();
  if (t === "" || t === "-") return null;
  const m = findMicByName(show.microphones, t) ?? findMicByName(catalog, t);
  return m ? { kind: "library", microphoneId: m.id } : { kind: "custom", name: t };
}

/** "" → null(기본값), "없음" → "" (스탠드 없음) */
export function parseStand(text: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  if (/^(없음|-|—|x|none|n\/a)$/i.test(t)) return "";
  return t;
}

/**
 * 포트 텍스트 해석.
 * - "12"          → 윗 행과 같은 스테이지박스(없으면 첫 박스)의 12번
 * - "Rio1608 3"   → 이름이 맞는 박스의 3번 (앞부분만 써도 됨: "1608 3", "rio16-3")
 * - "L1", "Local 1" → 콘솔 로컬
 * - 그 외          → 기타(자유 텍스트)
 */
export function parsePort(show: Show, index: number, text: string): PortRef | null {
  const t = text.trim();
  if (t === "" || t === "-") return null;
  const m = t.match(/^(.*?)[\s\-:#.]*(\d+)$/);
  if (m) {
    const prefix = norm(m[1]);
    const port = parseInt(m[2], 10);
    if (port >= 1) {
      if (prefix === "") {
        const above = show.inputs[index - 1]?.port;
        const boxId =
          above?.kind === "stagebox" ? above.stageBoxId : show.stageBoxes[0]?.id;
        if (boxId) return { kind: "stagebox", stageBoxId: boxId, port };
      } else if (/^(l|local|lo|로컬|콘솔)$/.test(prefix)) {
        return { kind: "local", port };
      } else {
        const boxes = show.stageBoxes;
        const box =
          boxes.find((b) => norm(b.name) === prefix) ??
          boxes.find((b) => norm(b.name).startsWith(prefix)) ??
          (boxes.filter((b) => norm(b.name).includes(prefix)).length === 1
            ? boxes.find((b) => norm(b.name).includes(prefix))
            : undefined);
        if (box) return { kind: "stagebox", stageBoxId: box.id, port };
      }
    }
  }
  return { kind: "other", label: t };
}

/** "1, 5" / "DCA 3" / "Drums" → DCA id 목록. 없는 번호·이름은 새 DCA를 만든다. */
export function parseDcas(show: Show, text: string): { show: Show; ids: string[] } {
  const dcas = show.dcas.slice();
  const ids: string[] = [];
  const tokens = text
    .split(/[,\s/;]+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(dca|vca|-)$/i.test(s));
  for (const tok of tokens) {
    const num = tok.match(/^(?:dca|vca)?(\d+)$/i);
    let dca = num
      ? dcas.find((d) => d.number === parseInt(num[1], 10))
      : dcas.find((d) => d.name.toLowerCase() === tok.toLowerCase());
    if (!dca) {
      const number = num
        ? parseInt(num[1], 10)
        : dcas.reduce((m, d) => Math.max(m, d.number), 0) + 1;
      if (number < 1) continue;
      dca = { id: newId(), number, name: num ? "" : tok };
      dcas.push(dca);
      dcas.sort((a, b) => a.number - b.number);
    }
    if (!ids.includes(dca.id)) ids.push(dca.id);
  }
  return { show: dcas.length === show.dcas.length ? show : { ...show, dcas }, ids };
}

/* ───────────── 열 ───────────── */

const textCol = (
  key: "source" | "shortName" | "notes",
  label: string,
  aliases: string[],
): Column => ({
  key,
  label,
  aliases,
  text: (_s, ch) => ch[key],
  editText: (_s, ch) => ch[key],
  set: (show, i, text) => updateChannel(show, i, { [key]: text.trim() }),
});

export const COLUMNS: Column[] = [
  {
    key: "ch",
    label: "Ch",
    aliases: ["ch", "chno", "channel", "no", "num", "number", "채널", "번호", "채널번호", "ch번호"],
    text: (_s, ch) => String(ch.number),
    editText: (_s, ch) => String(ch.number),
    set(show, i, text) {
      const m = text.match(/\d+/);
      const n = m ? parseInt(m[0], 10) : NaN;
      return n >= 1 ? updateChannel(show, i, { number: n }) : null;
    },
  },
  textCol("source", "소스명", [
    "source", "instrument", "inst", "instr", "name", "소스", "소스명", "악기", "악기명", "입력소스",
  ]),
  textCol("shortName", "짧은 이름", [
    "short", "shortname", "label", "scribble", "scribblestrip", "consolename", "chname",
    "짧은이름", "표시이름", "콘솔이름", "채널명", "채널이름",
  ]),
  {
    key: "mic",
    label: "마이크/DI",
    aliases: ["mic", "micdi", "mics", "microphone", "model", "di", "마이크", "마이크di", "기종"],
    text: (s, ch) => micName(s, ch),
    editText: (s, ch) => micName(s, ch),
    set(show, i, text, ctx) {
      const mic = parseMic(show, text, ctx?.catalog);
      let s = show;
      if (mic?.kind === "library" && !s.microphones.some((m) => m.id === mic.microphoneId)) {
        const lm = ctx?.catalog?.find((m) => m.id === mic.microphoneId);
        if (lm) s = ensureShowMic(s, lm).show;
      }
      return updateChannel(s, i, { mic });
    },
    suggestions: (s, ctx) => [
      ...new Set([...s.microphones.map((m) => m.model), ...(ctx?.catalog ?? []).map((m) => m.model)]),
    ],
  },
  {
    key: "stand",
    label: "스탠드",
    aliases: ["stand", "stands", "스탠드"],
    text: (s, ch) => (ch.stand === "" ? "없음" : resolveStand(s, ch)),
    editText: (_s, ch) => (ch.stand === "" ? "없음" : (ch.stand ?? "")),
    set: (show, i, text) => updateChannel(show, i, { stand: parseStand(text) }),
    suggestions: (s) =>
      [...new Set([
        "톨붐", "숏붐", "스트레이트", "클램프", "없음",
        ...s.microphones.map((m) => m.defaultStand),
        ...s.inputs.map((c) => c.stand ?? ""),
      ])].filter(Boolean),
  },
  {
    key: "phantom",
    label: "48V",
    aliases: ["48v", "phantom", "p48", "48", "팬텀", "팬텀전원"],
    toggle: true,
    text: (s, ch) => (resolvePhantom(s, ch) ? "48V" : ""),
    editText: (s, ch) => (resolvePhantom(s, ch) ? "48V" : ""),
    set(show, i, text) {
      const v = parseBool(text);
      return v === undefined ? null : updateChannel(show, i, { phantom: v });
    },
  },
  {
    key: "port",
    label: "스테이지박스 포트",
    aliases: [
      "port", "patch", "stagebox", "box", "sb", "rio", "sbport", "inputport",
      "스테이지박스", "포트", "패치", "박스", "입력포트", "스테이지박스포트",
    ],
    text: (s, ch) => (ch.port ? formatPort(ch.port, s.stageBoxes) : ""),
    editText: (s, ch) => (ch.port ? formatPort(ch.port, s.stageBoxes) : ""),
    set: (show, i, text) => updateChannel(show, i, { port: parsePort(show, i, text) }),
  },
  {
    key: "link",
    label: "링크",
    aliases: ["link", "stereo", "st", "stlink", "stereolink", "링크", "스테레오"],
    toggle: true,
    text: (_s, ch) => (ch.stereoLinkNext ? "Link" : ""),
    editText: (_s, ch) => (ch.stereoLinkNext ? "Link" : ""),
    set(show, i, text) {
      const v = parseBool(text);
      return v === undefined ? null : updateChannel(show, i, { stereoLinkNext: v === true });
    },
  },
  {
    key: "color",
    label: "컬러",
    aliases: ["color", "colour", "컬러", "색", "색상"],
    text: (_s, ch) => (ch.color === "none" ? "" : COLOR_LABEL[ch.color]),
    editText: (_s, ch) => (ch.color === "none" ? "" : COLOR_LABEL[ch.color]),
    set(show, i, text) {
      const c = parseColor(text);
      return c === undefined ? null : updateChannel(show, i, { color: c });
    },
    suggestions: () => Object.values(COLOR_LABEL),
  },
  {
    key: "dca",
    label: "DCA",
    aliases: ["dca", "dcas", "vca", "vcas", "dca그룹"],
    text: (s, ch) =>
      ch.dcaIds
        .map((id) => s.dcas.find((d) => d.id === id)?.number ?? "?")
        .join(", "),
    editText: (s, ch) =>
      ch.dcaIds
        .map((id) => s.dcas.find((d) => d.id === id)?.number ?? "")
        .join(", "),
    set(show, i, text) {
      const r = parseDcas(show, text);
      return updateChannel(r.show, i, { dcaIds: r.ids });
    },
  },
  textCol("notes", "비고", [
    "notes", "note", "comment", "comments", "remark", "remarks", "memo", "비고", "메모", "참고",
  ]),
];

export const COL_INDEX: Record<ColKey, number> = Object.fromEntries(
  COLUMNS.map((c, i) => [c.key, i]),
) as Record<ColKey, number>;

/** 엑셀 헤더 셀 → 열 (인식 못 하면 null) */
export function matchHeader(cell: string): Column | null {
  const n = norm(cell);
  if (!n) return null;
  return COLUMNS.find((c) => c.aliases.some((a) => norm(a) === n)) ?? null;
}

/** 검증 오류 경로의 필드명 → 열 */
export const FIELD_TO_COL: Partial<Record<keyof InputChannel, ColKey>> = {
  number: "ch",
  source: "source",
  shortName: "shortName",
  mic: "mic",
  stand: "stand",
  phantom: "phantom",
  port: "port",
  stereoLinkNext: "link",
  color: "color",
  dcaIds: "dca",
  notes: "notes",
};
