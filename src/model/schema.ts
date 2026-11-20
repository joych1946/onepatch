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
import { renameStand } from "./legacy";

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
  // 3단계 보완(국악 악기군)에서 추가. 콘솔에 없는 색은 내보내기 모듈이 가까운 색으로 바꾼다.
  "pink",
  "lime",
  "brown",
  "gray",
]);

/**
 * 물리 포트 위치. 인풋(소스가 꽂히는 곳)과 아웃풋(신호가 나가는 곳)이 같은 구조를 쓴다.
 * - stagebox: Show에 등록된 스테이지박스의 n번 포트
 * - local:    콘솔 본체의 로컬 단자 (화면 표기 "OMNI n" — 토크백 마이크, 레코더 출력 등)
 * - dante:    스테이지박스 없이 콘솔의 n번 Dante 입력/출력에 바로 (Dante 직결 장비)
 * - other:    그 외 (프로세서 등) — 자유 텍스트
 */
export const PortRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stagebox"), stageBoxId: Id, port: PositiveInt }),
  z.object({ kind: z.literal("local"), port: PositiveInt }),
  z.object({ kind: z.literal("dante"), port: PositiveInt }),
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
  /** 기본 스탠드 (예: 롱T, 숏T, 클램프). 없음은 빈 문자열. 예전 이름(톨붐·숏붐)은 읽을 때 바꾼다. */
  defaultStand: z.string().transform(renameStand),
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
  /** null = 마이크 기본값을 따름. 예전 이름(톨붐·숏붐)은 읽을 때 바꾼다. */
  stand: z.string().nullable().transform((v) => (v === null ? null : renameStand(v))),
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
  "lobby",
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
  /** Matrix 전용: 이 Matrix가 받는 버스들 (예: Main L/R, Aux 5). 다른 종류에서는 빈 배열. */
  sources: z.array(Id).default([]),
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

/**
 * 검사 결과 종류. 화면의 오류 검사 패널이 종류별로 묶어 보여준다.
 * (보유 수량 초과 mic-qty는 내 라이브러리와 비교해야 하므로 model/library에서 만든다)
 */
export const ISSUE_LABEL = {
  "dup-in-port": "같은 인풋 포트를 두 채널이 사용",
  "port-range": "박스 포트 수 초과",
  "ribbon-48v": "리본 마이크에 48V 켜짐",
  "no-48v": "콘덴서·액티브 DI인데 48V 꺼짐",
  "link-odd": "스테레오 링크가 홀수 채널에서 시작하지 않음",
  "short-name": "짧은 이름 글자 수 초과",
  "mic-qty": "마이크 보유 수량 초과",
  "dup-out-port": "물리 출력 포트 중복",
  "dup-number": "번호 중복",
  "link-missing": "링크 상대 채널 없음",
  "stereo-port": "스테레오 버스의 출력 포트 1개",
  ref: "깨진 참조",
  "dup-id": "id 중복",
} as const;
export type IssueCode = keyof typeof ISSUE_LABEL;

export type ShowIssue = { path: (string | number)[]; message: string; code?: IssueCode };

/**
 * 짧은 이름 글자 수의 기본값. 실제 기준은 콘솔 프로필(src/export/profile.ts의 nameMax)을
 * 화면에서 checkShow(show, { nameMax })로 넘겨 쓴다.
 */
export const SHORT_NAME_LIMIT = 8;

export interface CheckOptions {
  /** 짧은 이름 최대 글자 수 (콘솔 프로필) */
  nameMax?: number;
}

/**
 * Show 점검. 두 단계로 나눈다.
 * - error:   깨진 참조, id 중복 — 데이터가 성립하지 않으므로 저장·가져오기를 거부
 * - warning: 포트 중복·범위 초과, 48V, 링크, 이름 길이 등 — 작업 중에 흔히 생기는 상태라
 *            저장은 하되 화면에 표시해서 고치게 한다
 */
export function checkShow(show: z.infer<typeof ShowObjectSchema>, opts: CheckOptions = {}): {
  errors: ShowIssue[];
  warnings: ShowIssue[];
} {
  const errors: ShowIssue[] = [];
  const warnings: ShowIssue[] = [];
  const err = (path: ShowIssue["path"], message: string, code: IssueCode = "ref") => errors.push({ path, message, code });
  const warn = (path: ShowIssue["path"], message: string, code: IssueCode) => warnings.push({ path, message, code });
  const nameMax = opts.nameMax ?? SHORT_NAME_LIMIT;

  const dupCheck = <T>(
    items: T[],
    key: (t: T) => string | number,
    path: string,
    label: string,
    report: (path: ShowIssue["path"], message: string) => void,
  ) => {
    const seen = new Set<string | number>();
    items.forEach((item, i) => {
      const k = key(item);
      if (seen.has(k)) report([path, i], `${label} 중복: ${k}`);
      seen.add(k);
    });
  };
  const idErr = (p: ShowIssue["path"], m: string) => err(p, m, "dup-id");
  const numWarn = (p: ShowIssue["path"], m: string) => warn([...p, "number"], m, "dup-number");

  dupCheck(show.stageBoxes, (b) => b.id, "stageBoxes", "스테이지박스 id", idErr);
  dupCheck(show.microphones, (m) => m.id, "microphones", "마이크 id", idErr);
  dupCheck(show.dcas, (d) => d.id, "dcas", "DCA id", idErr);
  dupCheck(show.muteGroups, (g) => g.id, "muteGroups", "뮤트 그룹 id", idErr);
  dupCheck(show.inputs, (c) => c.id, "inputs", "채널 id", idErr);
  dupCheck(show.outputs, (o) => o.id, "outputs", "버스 id", idErr);

  dupCheck(show.dcas, (d) => d.number, "dcas", "DCA 번호", numWarn);
  dupCheck(show.muteGroups, (g) => g.number, "muteGroups", "뮤트 그룹 번호", numWarn);
  dupCheck(show.outputs, (o) => `${o.kind} ${o.number}`, "outputs", "버스", numWarn);
  // 채널 번호 중복은 겹치는 모든 행에 표시
  const counts = new Map<number, number>();
  show.inputs.forEach((c) => counts.set(c.number, (counts.get(c.number) ?? 0) + 1));
  show.inputs.forEach((c, i) => {
    if ((counts.get(c.number) ?? 0) > 1) warn(["inputs", i, "number"], `채널 번호 중복: ${c.number}`, "dup-number");
  });

  const boxes = new Map(show.stageBoxes.map((b) => [b.id, b]));
  const mics = new Map(show.microphones.map((m) => [m.id, m]));
  const dcaIds = new Set(show.dcas.map((d) => d.id));
  const muteIds = new Set(show.muteGroups.map((g) => g.id));
  const channelNumbers = new Set(show.inputs.map((c) => c.number));

  const portName = (p: z.infer<typeof PortRefSchema>) =>
    p.kind === "stagebox"
      ? `${boxes.get(p.stageBoxId)?.name ?? "?"} ${p.port}`
      : p.kind === "local"
        ? `OMNI ${p.port}`
        : p.kind === "dante"
          ? `Dante ${p.port}`
          : p.label;
  const portKey = (p: z.infer<typeof PortRefSchema>) =>
    p.kind === "stagebox" ? `${p.stageBoxId}:${p.port}` : p.kind === "other" ? null : `${p.kind}:${p.port}`;

  const checkPort = (
    port: z.infer<typeof PortRefSchema>,
    dir: "inputs" | "outputs",
    path: ShowIssue["path"],
  ) => {
    if (port.kind !== "stagebox") return;
    const box = boxes.get(port.stageBoxId);
    if (!box) return err(path, `없는 스테이지박스: ${port.stageBoxId}`);
    const max = dir === "inputs" ? box.inputs : box.outputs;
    if (port.port > max)
      warn(path, `${box.name} ${dir === "inputs" ? "인풋" : "아웃풋"} ${port.port}: 포트 수 초과 (최대 ${max})`, "port-range");
  };

  // 같은 인풋 포트를 쓰는 채널들
  const inPortUsers = new Map<string, number[]>();
  show.inputs.forEach((c) => {
    const k = c.port && portKey(c.port);
    if (k) inPortUsers.set(k, [...(inPortUsers.get(k) ?? []), c.number]);
  });

  show.inputs.forEach((ch, i) => {
    const at = (...p: (string | number)[]) => ["inputs", i, ...p];
    const mic = ch.mic?.kind === "library" ? mics.get(ch.mic.microphoneId) : undefined;
    if (ch.mic?.kind === "library" && !mic) err(at("mic"), `없는 마이크: ${ch.mic.microphoneId}`);
    if (ch.port) {
      checkPort(ch.port, "inputs", at("port"));
      const users = inPortUsers.get(portKey(ch.port) ?? "") ?? [];
      if (users.length > 1)
        warn(at("port"), `${portName(ch.port)}: Ch ${users.join(", ")}이(가) 같은 포트`, "dup-in-port");
    }
    // 48V: 채널 값이 없으면 마이크 기본값
    const phantom = ch.phantom ?? mic?.needsPhantom ?? false;
    if (mic?.type === "ribbon" && phantom && mic.needsPhantom !== true)
      warn(at("phantom"), `Ch ${ch.number} ${mic.model}: 리본 마이크에 48V가 켜져 있음`, "ribbon-48v");
    if (mic?.needsPhantom === true && !phantom)
      warn(
        at("phantom"),
        `Ch ${ch.number} ${mic.model}: ${mic.type === "di" ? "액티브 DI" : "콘덴서"}인데 48V가 꺼져 있음`,
        "no-48v",
      );
    if (ch.stereoLinkNext) {
      if (!channelNumbers.has(ch.number + 1))
        warn(at("stereoLinkNext"), `${ch.number}번의 링크 대상 ${ch.number + 1}번 채널이 없음`, "link-missing");
      if (ch.number % 2 === 0)
        warn(at("stereoLinkNext"), `Ch ${ch.number}–${ch.number + 1} 링크: 홀수 채널에서 시작해야 함`, "link-odd");
    }
    if ([...ch.shortName].length > nameMax)
      warn(at("shortName"), `Ch ${ch.number} “${ch.shortName}”: 짧은 이름 ${nameMax}자 초과`, "short-name");
    ch.dcaIds.forEach((id, j) => {
      if (!dcaIds.has(id)) err(at("dcaIds", j), `없는 DCA: ${id}`);
    });
    ch.muteGroupIds.forEach((id, j) => {
      if (!muteIds.has(id)) err(at("muteGroupIds", j), `없는 뮤트 그룹: ${id}`);
    });
  });

  // 같은 물리 출력을 쓰는 버스들 (한 버스 안에서 두 번도)
  const outPortUsers = new Map<string, string[]>();
  show.outputs.forEach((b) =>
    b.ports.forEach((p) => {
      const k = portKey(p);
      if (k) outPortUsers.set(k, [...(outPortUsers.get(k) ?? []), b.name || `${b.kind} ${b.number}`]);
    }),
  );

  const busIds = new Set(show.outputs.map((o) => o.id));
  show.outputs.forEach((bus, i) => {
    bus.ports.forEach((p, j) => checkPort(p, "outputs", ["outputs", i, "ports", j]));
    const dup = bus.ports.find((p) => (outPortUsers.get(portKey(p) ?? "")?.length ?? 0) > 1);
    if (dup)
      warn(["outputs", i, "ports"], `${portName(dup)}: ${outPortUsers.get(portKey(dup)!)!.join(", ")}이(가) 같은 출력`, "dup-out-port");
    bus.sources.forEach((id, j) => {
      if (!busIds.has(id)) err(["outputs", i, "sources", j], `없는 버스: ${id}`);
    });
    if (bus.width === "stereo" && bus.ports.length === 1)
      warn(["outputs", i, "ports"], `${bus.name || "버스"}: 스테레오인데 출력 포트가 1개`, "stereo-port");
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
