import { SCHEMA_VERSION, type Show, type StageBox } from "./schema";

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
    // 마이크는 내 라이브러리에서 고를 때 Show 안으로 복사된다 (Show JSON 하나로 완결)
    microphones: [],
    dcas: [],
    muteGroups: [],
    inputs: [],
    // 콘솔마다 있는 메인 출력 (패치만 채우면 된다)
    outputs: [
      { id: newId(), kind: "main", number: 1, name: "Main L/R", purpose: "pa", width: "stereo", tap: "post", ports: [], sources: [], notes: "" },
      { id: newId(), kind: "main", number: 2, name: "Mono/Sub", purpose: "sub", width: "mono", tap: "post", ports: [], sources: [], notes: "" },
    ],
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
