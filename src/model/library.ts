/**
 * 내 라이브러리: Show와 별개로 브라우저에 하나만 있는 사용자 데이터.
 * - 마이크/DI 목록 + 보유 수량
 * - 소스 목록(악기군별) + 소스별 추천 마이크 순서
 *
 * Show는 여기서 고른 마이크를 자기 안(show.microphones)에 복사해 두므로
 * Show JSON 하나만으로도 완결된다. 라이브러리 마이크와 Show 마이크는 같은 id로 이어진다.
 */
import { z } from "zod";
import { newId } from "./factory";
import { bareModel, norm } from "./text";
import {
  ColorSchema,
  MicTypeSchema,
  type InputChannel,
  type Microphone,
  type MicType,
  type Show,
  type ShowIssue,
} from "./schema";

export const LIBRARY_VERSION = 1;
const Id = z.string().min(1);

export const LibraryMicSchema = z.object({
  id: Id,
  model: z.string().min(1),
  type: MicTypeSchema,
  /** null = 미확인 */
  needsPhantom: z.boolean().nullable(),
  defaultStand: z.string(),
  /** 보유 수량. null = 수량을 관리하지 않음 */
  owned: z.number().int().min(0).nullable(),
  /** 기본 목록에서 온 항목 (삭제 대신 수정만) */
  builtin: z.boolean(),
});

export const SourceGroupSchema = z.object({ id: Id, name: z.string() });

export const SourceDefSchema = z.object({
  id: Id,
  /** 스테레오면 "OH"처럼 공통 이름. 채널에는 "OH L", "OH R"로 들어간다. */
  name: z.string().min(1),
  shortName: z.string(),
  groupId: Id,
  color: ColorSchema,
  stereo: z.boolean(),
  /** 추천 마이크 (앞일수록 우선) */
  micIds: z.array(Id),
});

export const LibrarySchema = z.object({
  schemaVersion: z.literal(LIBRARY_VERSION),
  microphones: z.array(LibraryMicSchema),
  groups: z.array(SourceGroupSchema),
  /** 배열 순서 = 같은 악기군 안에서의 순서 */
  sources: z.array(SourceDefSchema),
});

export type LibraryMic = z.infer<typeof LibraryMicSchema>;
export type SourceGroup = z.infer<typeof SourceGroupSchema>;
export type SourceDef = z.infer<typeof SourceDefSchema>;
export type Library = z.infer<typeof LibrarySchema>;

export const libId = (prefix: string) => `${prefix}-u-${newId().slice(0, 8)}`;

/* ───────────── 소스 ───────────── */

/** 악기군 순서 → 군 안의 순서로 펼친 목록 (다음 소스 제안의 기준 순서) */
export function orderedSources(lib: Library): SourceDef[] {
  return lib.groups.flatMap((g) => lib.sources.filter((s) => s.groupId === g.id));
}

/** 소스가 채널에 들어갈 이름 (스테레오면 L/R 두 개) */
export function channelsOf(src: SourceDef): { source: string; shortName: string }[] {
  if (!src.stereo) return [{ source: src.name, shortName: src.shortName }];
  return (["L", "R"] as const).map((side) => ({
    source: `${src.name} ${side}`,
    shortName: `${src.shortName} ${side}`,
  }));
}

export const sourceLabel = (src: SourceDef) => (src.stereo ? `${src.name} L/R` : src.name);

/** 채널 소스명 → 라이브러리 소스 (side: 0 = 모노/L, 1 = R) */
export function findSource(lib: Library, channelSource: string): { src: SourceDef; side: 0 | 1 } | null {
  const n = norm(channelSource);
  if (!n) return null;
  for (const src of lib.sources) {
    const chs = channelsOf(src);
    const side = chs.findIndex((c) => norm(c.source) === n);
    if (side >= 0) return { src, side: side as 0 | 1 };
  }
  return null;
}

/**
 * 직전 채널을 보고 다음에 올 소스 제안.
 * 라이브러리 순서에서 직전 소스 다음 것들 중 이 Show에서 아직 안 쓴 것.
 */
export function suggestNextSources(lib: Library, show: Show, index: number, limit = 3): SourceDef[] {
  const order = orderedSources(lib);
  const used = new Set(
    show.inputs.flatMap((c, i) => {
      if (i === index) return [];
      const f = findSource(lib, c.source);
      return f ? [f.src.id] : [];
    }),
  );
  let from = 0;
  for (let i = Math.min(index, show.inputs.length) - 1; i >= 0; i--) {
    const f = findSource(lib, show.inputs[i].source);
    if (f) {
      from = order.findIndex((s) => s.id === f.src.id) + 1;
      break;
    }
  }
  return order.slice(from).filter((s) => !used.has(s.id)).slice(0, limit);
}

/** 사용자가 고른 마이크를 그 소스의 추천 목록에서 한 칸 올린다 (없으면 맨 뒤에 추가) */
export function learnPick(lib: Library, sourceId: string, micId: string): Library {
  const sources = lib.sources.map((s) => {
    if (s.id !== sourceId) return s;
    const ids = s.micIds.slice();
    const i = ids.indexOf(micId);
    if (i === 0) return s;
    if (i < 0) ids.push(micId);
    else [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    return { ...s, micIds: ids };
  });
  return { ...lib, sources };
}

export function addSource(lib: Library, name: string, groupId: string): { lib: Library; src: SourceDef } {
  const group = lib.groups.find((g) => g.id === groupId);
  const sibling = lib.sources.find((s) => s.groupId === groupId);
  const src: SourceDef = {
    id: libId("src"),
    name: name.trim(),
    shortName: name.trim().replace(/\s+/g, "").slice(0, 8),
    groupId: group ? group.id : lib.groups[0].id,
    color: sibling?.color ?? "none",
    stereo: false,
    micIds: [],
  };
  // 같은 악기군의 마지막 뒤에 넣는다
  const last = lib.sources.map((s) => s.groupId).lastIndexOf(src.groupId);
  const sources = lib.sources.slice();
  sources.splice(last + 1, 0, src);
  return { lib: { ...lib, sources }, src };
}

/* ───────────── 마이크 ───────────── */

export function addMic(lib: Library, model: string, type: MicType): { lib: Library; mic: LibraryMic } {
  const mic: LibraryMic = {
    id: libId("mic"),
    model: model.trim(),
    type,
    // 다이내믹은 구조상 48V가 필요 없다. 나머지는 사양을 모르므로 미확인.
    needsPhantom: type === "dynamic" ? false : null,
    defaultStand: "",
    owned: null,
    builtin: false,
  };
  return { lib: { ...lib, microphones: [...lib.microphones, mic] }, mic };
}

export function toShowMic(m: LibraryMic): Microphone {
  return { id: m.id, model: m.model, type: m.type, needsPhantom: m.needsPhantom, defaultStand: m.defaultStand };
}

/**
 * 이름으로 마이크 찾기: 정확히 → 제조사 생략 → (3자 이상일 때) 유일하게 맞는
 * 끝부분("SM58") → 제조사 뺀 앞부분("C414" → AKG C414 XLS) → 포함
 */
export function findMicByName<T extends { model: string }>(list: T[], text: string): T | undefined {
  const n = norm(text);
  if (!n) return undefined;
  const exact = list.find((m) => norm(m.model) === n) ?? list.find((m) => bareModel(m.model) === n);
  if (exact) return exact;
  if (n.length < 3) return undefined;
  const tests = [
    (m: T) => norm(m.model).endsWith(n),
    (m: T) => bareModel(m.model).startsWith(n),
    (m: T) => norm(m.model).includes(n),
  ];
  for (const t of tests) {
    const hits = list.filter(t);
    if (hits.length === 1) return hits[0];
  }
  return undefined;
}

/**
 * Show 안에 라이브러리 마이크 사본을 넣고 그 id를 돌려준다.
 * 이미 같은 모델이 (예전 Show라 다른 id로) 있으면 그것을 쓴다.
 */
export function ensureShowMic(show: Show, mic: LibraryMic): { show: Show; id: string } {
  const snap = toShowMic(mic);
  const i = show.microphones.findIndex((m) => m.id === mic.id);
  if (i >= 0) {
    const cur = show.microphones[i];
    const same =
      cur.model === snap.model &&
      cur.type === snap.type &&
      cur.needsPhantom === snap.needsPhantom &&
      cur.defaultStand === snap.defaultStand;
    if (same) return { show, id: mic.id };
    const microphones = show.microphones.slice();
    microphones[i] = snap;
    return { show: { ...show, microphones }, id: mic.id };
  }
  const byModel = show.microphones.find((m) => norm(m.model) === norm(mic.model));
  if (byModel) return { show, id: byModel.id };
  return { show: { ...show, microphones: [...show.microphones, snap] }, id: mic.id };
}

/** 채널의 마이크 → 라이브러리 마이크 (id가 같거나, 예전 Show면 모델명이 같은 것) */
export function libMicOf(lib: Library, show: Show, ch: InputChannel): LibraryMic | undefined {
  if (!ch.mic) return undefined;
  if (ch.mic.kind === "custom") {
    const n = norm(ch.mic.name);
    return lib.microphones.find((m) => norm(m.model) === n);
  }
  const id = ch.mic.microphoneId;
  const direct = lib.microphones.find((m) => m.id === id);
  if (direct) return direct;
  const model = show.microphones.find((m) => m.id === id)?.model;
  return model ? lib.microphones.find((m) => norm(m.model) === norm(model)) : undefined;
}

/** 라이브러리 마이크 id → 이 Show에서 쓰는 채널 수 */
export function usageCounts(lib: Library, show: Show): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of show.inputs) {
    const m = libMicOf(lib, show, ch);
    if (m) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  }
  return counts;
}

/** 보유 수량보다 많이 쓴 마이크를 쓰는 채널마다 경고 */
export function quantityIssues(lib: Library, show: Show): ShowIssue[] {
  const counts = usageCounts(lib, show);
  const issues: ShowIssue[] = [];
  show.inputs.forEach((ch, i) => {
    const m = libMicOf(lib, show, ch);
    if (!m || m.owned === null) return;
    const used = counts.get(m.id) ?? 0;
    if (used > m.owned)
      issues.push({ path: ["inputs", i, "mic"], message: `${m.model}: 보유 ${m.owned}개인데 ${used}개 사용` });
  });
  return issues;
}

export interface MicOption {
  mic: LibraryMic;
  used: number;
  /** 남은 수량 (수량 관리 안 하면 null) */
  remaining: number | null;
}

const isOwned = (m: LibraryMic) => m.owned !== null && m.owned > 0;

/**
 * 마이크 선택 목록.
 * recommended: 소스의 추천 순서를 따르되, 내가 보유한 모델을 먼저.
 * others:      나머지 전부 (보유한 것 먼저, 그 다음 라이브러리 순서).
 */
export function micOptions(lib: Library, show: Show, src: SourceDef | null) {
  const counts = usageCounts(lib, show);
  const opt = (mic: LibraryMic): MicOption => {
    const used = counts.get(mic.id) ?? 0;
    return { mic, used, remaining: mic.owned === null ? null : mic.owned - used };
  };
  const byId = new Map(lib.microphones.map((m) => [m.id, m]));
  const recIds = src ? src.micIds.filter((id) => byId.has(id)) : [];
  const ownedFirst = (list: LibraryMic[]) => [...list.filter(isOwned), ...list.filter((m) => !isOwned(m))];
  const recommended = ownedFirst(recIds.map((id) => byId.get(id)!)).map(opt);
  const rec = new Set(recIds);
  const others = ownedFirst(lib.microphones.filter((m) => !rec.has(m.id))).map(opt);
  return { recommended, others };
}
