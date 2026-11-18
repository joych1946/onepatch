/**
 * Show 데이터 모델 — 앱 전체의 단일 원천(single source of truth).
 *
 * - zod 스키마가 곧 타입 정의다. TypeScript 타입은 z.infer로 파생하므로
 *   "타입"과 "가져오기 검증 규칙"이 따로 놀 수 없다.
 * - 기종 중립: 콘솔별 제약(이름 글자 수, 컬러 팔레트, 스테레오 버스 번호 체계 등)은
 *   여기서 강제하지 않는다. 그런 변환은 내보내기 모듈의 몫이다.
 * - 엔티티 간 연결은 배열 인덱스가 아니라 id 참조로 한다.
 *   (채널 순서를 바꾸거나 항목을 삭제해도 참조가 깨지지 않게)
 */
import { z } from "zod";

/** JSON 파일 포맷 버전. 구조가 바뀌면 올리고 마이그레이션을 추가한다. */
export const SCHEMA_VERSION = 1;

const Id = z.string().min(1);
const PositiveInt = z.number().int().min(1);

/* ───────────── 공통 ───────────── */

/** 기종 중립 팔레트. 콘솔 컬러로의 매핑은 내보내기 모듈에서 한다. */
export const ColorSchema = z.enum([
  "none",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "white",
]);

/**
 * 물리 포트 위치. 인풋(소스가 꽂히는 곳)과 아웃풋(신호가 나가는 곳)이 같은 구조를 쓴다.
 * - stagebox: Show에 등록된 스테이지박스의 n번 포트
 * - local:    콘솔 본체의 로컬 단자 (예: 토크백 마이크, 레코더 출력)
 * - other:    그 외 (Dante 직결, 프로세서 등) — 자유 텍스트
 */
export const PortRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stagebox"), stageBoxId: Id, port: PositiveInt }),
  z.object({ kind: z.literal("local"), port: PositiveInt }),
  z.object({ kind: z.literal("other"), label: z.string() }),
]);

/* ───────────── 장비 ───────────── */

export const StageBoxSchema = z.object({
  id: Id,
  name: z.string(),
  inputs: z.number().int().min(0),
  outputs: z.number().int().min(0),
  location: z.string(),
});

export const MicTypeSchema = z.enum([
  "dynamic",
  "condenser",
  "ribbon",
  "di",
  "wireless",
]);

/** 마이크 라이브러리 항목. Show 안에 포함되어 JSON 하나로 완결된다. */
export const MicrophoneSchema = z.object({
  id: Id,
  model: z.string().min(1),
  type: MicTypeSchema,
  /** null = 사양 미확인 (추측으로 채우지 않는다) */
  needsPhantom: z.boolean().nullable(),
  /** 기본 스탠드 (예: 톨붐, 숏붐, 클램프). 없음은 빈 문자열. */
  defaultStand: z.string(),
});

/** 채널에 쓰는 마이크: 라이브러리 참조 또는 라이브러리에 없는 장비의 자유 입력 */
export const MicRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library"), microphoneId: Id }),
  z.object({ kind: z.literal("custom"), name: z.string().min(1) }),
]);

/* ───────────── 그룹 ───────────── */

export const DcaSchema = z.object({
  id: Id,
  number: PositiveInt,
  name: z.string(),
});

export const MuteGroupSchema = z.object({
  id: Id,
  number: PositiveInt,
  name: z.string(),
});

/* ───────────── 인풋 ───────────── */

export const InputChannelSchema = z.object({
  id: Id,
  number: PositiveInt,
  /** 소스명 (예: Kick In) */
  source: z.string(),
  /** 콘솔 표시용 짧은 이름. 길이 제한은 경고만 하고 자르는 건 내보내기에서. */
  shortName: z.string(),
  /** 연주자/파트 (예: Drums, Gt.1 김OO) */
  performer: z.string(),
  mic: MicRefSchema.nullable(),
  /** null = 마이크 기본값을 따름 */
  stand: z.string().nullable(),
  /** null = 마이크 기본값을 따름 */
  phantom: z.boolean().nullable(),
  /** null = 아직 패치 안 함 */
  port: PortRefSchema.nullable(),
  /** true면 다음 번호 채널과 스테레오 링크 (예: 9번에 true → 9/10 링크) */
  stereoLinkNext: z.boolean(),
  color: ColorSchema,
  dcaIds: z.array(Id),
  muteGroupIds: z.array(Id),
  notes: z.string(),
});

/* ───────────── 아웃풋 ───────────── */

export const BusKindSchema = z.enum(["aux", "matrix", "main"]);

export const BusPurposeSchema = z.enum([
  "wedge",
  "iem",
  "sidefill",
  "fx",
  "pa",
  "sub",
  "frontfill",
  "delay",
  "record",
  "broadcast",
  "other",
]);

export const OutputBusSchema = z.object({
  id: Id,
  kind: BusKindSchema,
  /** 종류 안에서의 번호 (Aux 1, Matrix 1, Main 1…). 스테레오 버스도 한 행이다. */
  number: PositiveInt,
  name: z.string(),
  purpose: BusPurposeSchema,
  width: z.enum(["mono", "stereo"]),
  /** 센드 탭 포인트. Main에는 의미 없음. */
  tap: z.enum(["pre", "post"]),
  /** 물리 출력. 스테레오면 보통 [L, R] 2개, FX처럼 내부 버스면 빈 배열. */
  ports: z.array(PortRefSchema),
  notes: z.string(),
});

/* ───────────── Show ───────────── */

const ShowObjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  title: z.string(),
  /** YYYY-MM-DD, 미정이면 빈 문자열 */
  date: z.union([z.literal(""), z.iso.date()]),
  venue: z.string(),
  author: z.string(),
  /** 문서 버전 (예: v3, 0612 리허설 후) */
  version: z.string(),
  notes: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  stageBoxes: z.array(StageBoxSchema),
  microphones: z.array(MicrophoneSchema),
  dcas: z.array(DcaSchema),
  muteGroups: z.array(MuteGroupSchema),
  inputs: z.array(InputChannelSchema),
  outputs: z.array(OutputBusSchema),
});

export type ShowIssue = { path: (string | number)[]; message: string };

/**
 * Show 점검. 두 단계로 나눈다.
 * - error:   깨진 참조, id 중복 — 데이터가 성립하지 않으므로 저장·가져오기를 거부
 * - warning: 채널 번호 중복, 포트 범위 초과, 링크 상대 없음 — 작업 중에 흔히 생기는 상태라
 *            저장은 하되 화면에 표시해서 고치게 한다
 */
export function checkShow(show: z.infer<typeof ShowObjectSchema>): {
  errors: ShowIssue[];
  warnings: ShowIssue[];
} {
  const errors: ShowIssue[] = [];
  const warnings: ShowIssue[] = [];
  const err = (path: ShowIssue["path"], message: string) => errors.push({ path, message });
  const warn = (path: ShowIssue["path"], message: string) => warnings.push({ path, message });

  const dupCheck = <T>(
    items: T[],
    key: (t: T) => string | number,
    path: string,
    label: string,
    report: typeof err,
  ) => {
    const seen = new Set<string | number>();
    items.forEach((item, i) => {
      const k = key(item);
      if (seen.has(k)) report([path, i], `${label} 중복: ${k}`);
      seen.add(k);
    });
  };

  dupCheck(show.stageBoxes, (b) => b.id, "stageBoxes", "스테이지박스 id", err);
  dupCheck(show.microphones, (m) => m.id, "microphones", "마이크 id", err);
  dupCheck(show.dcas, (d) => d.id, "dcas", "DCA id", err);
  dupCheck(show.muteGroups, (g) => g.id, "muteGroups", "뮤트 그룹 id", err);
  dupCheck(show.inputs, (c) => c.id, "inputs", "채널 id", err);
  dupCheck(show.outputs, (o) => o.id, "outputs", "버스 id", err);

  dupCheck(show.dcas, (d) => d.number, "dcas", "DCA 번호", warn);
  dupCheck(show.muteGroups, (g) => g.number, "muteGroups", "뮤트 그룹 번호", warn);
  dupCheck(show.outputs, (o) => `${o.kind} ${o.number}`, "outputs", "버스", warn);
  // 채널 번호 중복은 겹치는 모든 행에 표시
  const counts = new Map<number, number>();
  show.inputs.forEach((c) => counts.set(c.number, (counts.get(c.number) ?? 0) + 1));
  show.inputs.forEach((c, i) => {
    if ((counts.get(c.number) ?? 0) > 1) warn(["inputs", i, "number"], `채널 번호 중복: ${c.number}`);
  });

  const boxes = new Map(show.stageBoxes.map((b) => [b.id, b]));
  const micIds = new Set(show.microphones.map((m) => m.id));
  const dcaIds = new Set(show.dcas.map((d) => d.id));
  const muteIds = new Set(show.muteGroups.map((g) => g.id));
  const channelNumbers = new Set(show.inputs.map((c) => c.number));

  const checkPort = (
    port: z.infer<typeof PortRefSchema>,
    dir: "inputs" | "outputs",
    path: ShowIssue["path"],
  ) => {
    if (port.kind !== "stagebox") return;
    const box = boxes.get(port.stageBoxId);
    if (!box) return err(path, `없는 스테이지박스: ${port.stageBoxId}`);
    const max = dir === "inputs" ? box.inputs : box.outputs;
    if (port.port > max) warn(path, `${box.name} 포트 범위 초과: ${port.port} (최대 ${max})`);
  };

  show.inputs.forEach((ch, i) => {
    const at = (...p: (string | number)[]) => ["inputs", i, ...p];
    if (ch.mic?.kind === "library" && !micIds.has(ch.mic.microphoneId))
      err(at("mic"), `없는 마이크: ${ch.mic.microphoneId}`);
    if (ch.port) checkPort(ch.port, "inputs", at("port"));
    if (ch.stereoLinkNext && !channelNumbers.has(ch.number + 1))
      warn(at("stereoLinkNext"), `${ch.number}번의 링크 대상 ${ch.number + 1}번 채널이 없음`);
    ch.dcaIds.forEach((id, j) => {
      if (!dcaIds.has(id)) err(at("dcaIds", j), `없는 DCA: ${id}`);
    });
    ch.muteGroupIds.forEach((id, j) => {
      if (!muteIds.has(id)) err(at("muteGroupIds", j), `없는 뮤트 그룹: ${id}`);
    });
  });

  show.outputs.forEach((bus, i) => {
    bus.ports.forEach((p, j) => checkPort(p, "outputs", ["outputs", i, "ports", j]));
  });

  return { errors, warnings };
}

/** 구조 + 참조 무결성(error 단계)까지 검사하는 Show 스키마. 저장·가져오기에 사용. */
export const ShowSchema = ShowObjectSchema.superRefine((show, ctx) => {
  for (const e of checkShow(show).errors)
    ctx.addIssue({ code: "custom", path: e.path, message: e.message });
});

/* ───────────── 타입 ───────────── */

export type Color = z.infer<typeof ColorSchema>;
export type PortRef = z.infer<typeof PortRefSchema>;
export type StageBox = z.infer<typeof StageBoxSchema>;
export type MicType = z.infer<typeof MicTypeSchema>;
export type Microphone = z.infer<typeof MicrophoneSchema>;
export type MicRef = z.infer<typeof MicRefSchema>;
export type Dca = z.infer<typeof DcaSchema>;
export type MuteGroup = z.infer<typeof MuteGroupSchema>;
export type InputChannel = z.infer<typeof InputChannelSchema>;
export type BusKind = z.infer<typeof BusKindSchema>;
export type BusPurpose = z.infer<typeof BusPurposeSchema>;
export type OutputBus = z.infer<typeof OutputBusSchema>;
export type Show = z.infer<typeof ShowSchema>;
