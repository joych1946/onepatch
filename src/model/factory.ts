import { SCHEMA_VERSION, type Microphone, type Show, type StageBox } from "./schema";

export function newId(): string {
  return crypto.randomUUID();
}

/** 자주 쓰는 스테이지박스 구성 (CLAUDE.md [내 환경]) — 새 Show의 기본값 */
export function defaultStageBoxes(): StageBox[] {
  return [
    { id: newId(), name: "Rio3224", inputs: 32, outputs: 16, location: "무대 하수(SL)" },
    { id: newId(), name: "Rio1608", inputs: 16, outputs: 8, location: "무대 상수(SR)" },
  ];
}

/** 새 Show에 미리 넣어두는 기본 마이크 라이브러리 */
export function starterMicrophones(): Microphone[] {
  const m = (
    model: string,
    type: Microphone["type"],
    needsPhantom: boolean,
    defaultStand: string,
  ): Microphone => ({ id: newId(), model, type, needsPhantom, defaultStand });
  return [
    m("Shure SM58", "dynamic", false, "톨붐"),
    m("Shure SM57", "dynamic", false, "숏붐"),
    m("Shure Beta 52A", "dynamic", false, "숏붐"),
    m("Shure Beta 91A", "condenser", true, ""),
    m("Shure SM81", "condenser", true, "숏붐"),
    m("Sennheiser e604", "dynamic", false, "클램프"),
    m("Sennheiser e906", "dynamic", false, ""),
    m("Sennheiser MD421", "dynamic", false, "숏붐"),
    m("Neumann KM184", "condenser", true, "톨붐"),
    m("Radial J48", "di", true, ""),
    m("Radial ProD2", "di", false, ""),
    m("Shure ULXD2/B58", "wireless", false, ""),
  ];
}

export function createEmptyShow(title = "새 공연"): Show {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title,
    date: "",
    venue: "",
    author: "",
    version: "v1",
    notes: "",
    createdAt: now,
    updatedAt: now,
    stageBoxes: defaultStageBoxes(),
    microphones: starterMicrophones(),
    dcas: [],
    muteGroups: [],
    inputs: [],
    outputs: [],
  };
}

/** 복제: Show id와 시각만 새로. 내부 id(마이크, 박스 등)는 Show 안에서만 유효하므로 그대로 둔다. */
export function duplicateShow(show: Show): Show {
  const now = new Date().toISOString();
  return {
    ...structuredClone(show),
    id: newId(),
    title: `${show.title} (사본)`,
    createdAt: now,
    updatedAt: now,
  };
}
