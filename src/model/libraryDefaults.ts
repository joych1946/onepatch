/**
 * 처음 쓸 때 내 라이브러리에 채워 넣는 기본값.
 * - 마이크/DI: 현장에서 흔한 모델. 48V 필요 여부를 확신할 수 없는 모델은 null(미확인)로 둔다.
 * - 소스: 악기군별 기본 목록과 소스별 추천 마이크(앞에 있을수록 우선).
 * 기본 스탠드는 사양이 아니라 흔한 용도 기준의 출발값이다.
 */
import type { Color, MicType } from "./schema";
import { LIBRARY_VERSION, type Library, type LibraryMic, type SourceDef } from "./library";
import { norm } from "./text";

type M = [id: string, model: string, type: MicType, phantom: boolean | null, stand: string];

const D = "dynamic";
const C = "condenser";
const R = "ribbon";
const DI = "di";
const W = "wireless";

const MICS: M[] = [
  // Shure
  ["mic-sm58", "Shure SM58", D, false, "롱T"],
  ["mic-beta58a", "Shure Beta 58A", D, false, "롱T"],
  ["mic-sm57", "Shure SM57", D, false, "숏T"],
  ["mic-beta57a", "Shure Beta 57A", D, false, "숏T"],
  ["mic-beta52a", "Shure Beta 52A", D, false, "숏T"],
  ["mic-beta91a", "Shure Beta 91A", C, true, ""],
  ["mic-beta56a", "Shure Beta 56A", D, false, "클램프"],
  ["mic-beta98amp", "Shure Beta 98AMP", C, true, "클램프"],
  ["mic-beta98hc", "Shure Beta 98H/C", C, true, ""],
  ["mic-beta87a", "Shure Beta 87A", C, true, "롱T"],
  ["mic-sm81", "Shure SM81", C, true, "숏T"],
  ["mic-ksm9", "Shure KSM9", C, true, "롱T"],
  ["mic-ksm32", "Shure KSM32", C, true, "롱T"],
  ["mic-ksm137", "Shure KSM137", C, true, "숏T"],
  ["mic-sm7b", "Shure SM7B", D, false, "롱T"],
  // Sennheiser
  ["mic-e835", "Sennheiser e835", D, false, "롱T"],
  ["mic-e935", "Sennheiser e935", D, false, "롱T"],
  ["mic-e945", "Sennheiser e945", D, false, "롱T"],
  ["mic-e965", "Sennheiser e965", C, true, "롱T"],
  ["mic-e604", "Sennheiser e604", D, false, "클램프"],
  ["mic-e904", "Sennheiser e904", D, false, "클램프"],
  ["mic-e906", "Sennheiser e906", D, false, "숏T"],
  ["mic-e901", "Sennheiser e901", C, true, ""],
  ["mic-e902", "Sennheiser e902", D, false, "숏T"],
  ["mic-e614", "Sennheiser e614", C, true, "숏T"],
  ["mic-md421", "Sennheiser MD 421-II", D, false, "숏T"],
  ["mic-md441", "Sennheiser MD 441-U", D, false, "숏T"],
  // AKG
  ["mic-d112", "AKG D112 MkII", D, false, "숏T"],
  ["mic-c414", "AKG C414 XLS", C, true, "롱T"],
  ["mic-c451b", "AKG C451 B", C, true, "숏T"],
  ["mic-c214", "AKG C214", C, true, "롱T"],
  // Audix
  ["mic-d6", "Audix D6", D, false, "숏T"],
  ["mic-d2", "Audix D2", D, false, "클램프"],
  ["mic-d4", "Audix D4", D, false, "클램프"],
  ["mic-i5", "Audix i5", D, false, "숏T"],
  // 그 외 마이크
  ["mic-re20", "Electro-Voice RE20", D, false, "숏T"],
  ["mic-km184", "Neumann KM 184", C, true, "롱T"],
  ["mic-kms105", "Neumann KMS 105", C, true, "롱T"],
  ["mic-tlm103", "Neumann TLM 103", C, true, "롱T"],
  ["mic-nt5", "Rode NT5", C, true, "롱T"],
  ["mic-dpa4099", "DPA 4099", C, true, ""],
  ["mic-dpa4018v", "DPA 4018V", C, true, "롱T"],
  ["mic-r121", "Royer R-121", R, false, "숏T"],
  ["mic-m88", "Beyerdynamic M 88 TG", D, false, "롱T"],
  ["mic-m201", "Beyerdynamic M 201 TG", D, false, "숏T"],
  ["mic-at4050", "Audio-Technica AT4050", C, true, "롱T"],
  // 무선 (수신기 출력이므로 48V 불필요)
  ["mic-ulxd-b58", "Shure ULXD (Beta 58A)", W, false, ""],
  ["mic-ulxd-sm58", "Shure ULXD (SM58)", W, false, ""],
  ["mic-qlxd-b58", "Shure QLXD (Beta 58A)", W, false, ""],
  ["mic-ew500-935", "Sennheiser ew 500 G4 (e935)", W, false, ""],
  // DI
  ["mic-j48", "Radial J48", DI, true, ""],
  ["mic-jdi", "Radial JDI", DI, false, ""],
  ["mic-prodi", "Radial ProDI", DI, false, ""],
  ["mic-ar133", "BSS AR-133", DI, true, ""],
  ["mic-type85", "Countryman Type 85", DI, true, ""],
  ["mic-dn100", "Klark Teknik DN100", DI, null, ""],
  ["mic-di100", "Behringer DI100", DI, null, ""],
];

/*
 * 무선 시스템 (3판). 수신기 출력이 마이크·라인 레벨이라 48V는 쓰지 않는다.
 * 핸드헬드는 캡슐별, 바디팩은 헤드셋·라벨리어·악기용으로 나눈다 (헤드셋·라벨리어 모델은 현장마다 달라 묶음 이름만).
 * 캡슐 조합은 제조사 공식 호환 목록으로 확인한 것만 넣는다:
 * - Shure AD2·ULXD2·QLXD2·SLXD2 사용 설명서 (pubs.shure.com/view/guide/{AD2,ULXD,QLXD,SLXD}), QLXD2/K8 제품 페이지
 *   SLX-D의 KSM8·SM86·Beta 87C는 "지역에 따라 판매"로 표시된 공식 조합
 * - Sennheiser EW-DX·EW-D SKM 제품 사양서, Digital 6000·ew G4 액세서리 문서 (docs.cloud.sennheiser.com)
 * 이미 있던 ULXD(Beta 58A·SM58), QLXD(Beta 58A), ew 500 G4(e935)는 그대로 두고 겹치는 조합은 넣지 않는다.
 */
const WIRELESS_SINCE = 3;
const wl = (prefix: string, system: string, handheld: string, capsules: string[], skip: string[] = []): M[] =>
  capsules
    .filter((c) => !skip.includes(c))
    .map((c) => [`mic-w-${prefix}-${c.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, `${system} ${handheld} (${c})`, W, false, ""]);
const bodypacks = (prefix: string, system: string, pack: string): M[] => [
  [`mic-w-${prefix}-hs`, `${system} ${pack} 바디팩 + 헤드셋`, W, false, ""],
  [`mic-w-${prefix}-lav`, `${system} ${pack} 바디팩 + 라벨리어`, W, false, ""],
  [`mic-w-${prefix}-inst`, `${system} ${pack} 바디팩 (악기용)`, W, false, ""],
];
const SHURE_VOCAL = ["SM58", "Beta 58A", "SM86", "SM87A", "Beta 87A", "Beta 87C", "KSM8", "KSM9", "KSM9HS"];
const SENN_EVO = ["MMD 835", "MMD 845", "MME 865", "MMD 935", "MMD 945", "MMK 965"];
const NEUMANN = ["Neumann KK 204", "Neumann KK 205"];
const WIRELESS: M[] = [
  ...wl("ad2", "Shure Axient Digital", "AD2", [...SHURE_VOCAL, "KSM11", "VP68", "NXN8/C", "NXN8/S"]),
  ...bodypacks("ad1", "Shure Axient Digital", "AD1"),
  ...wl("ulxd2", "Shure ULX-D", "ULXD2", [...SHURE_VOCAL, "NXN8/C", "NXN8/S"], ["SM58", "Beta 58A"]),
  ...bodypacks("ulxd1", "Shure ULX-D", "ULXD1"),
  ...wl("qlxd2", "Shure QLX-D", "QLXD2", [...SHURE_VOCAL, "NXN8/C", "NXN8/S"], ["Beta 58A"]),
  ...bodypacks("qlxd1", "Shure QLX-D", "QLXD1"),
  ...wl("slxd2", "Shure SLX-D", "SLXD2", ["SM58", "Beta 58A", "Beta 87A", "SM86", "Beta 87C", "KSM8", "NXN8/C", "NXN8/S"]),
  ...bodypacks("slxd1", "Shure SLX-D", "SLXD1"),
  ...wl("ewdx", "Sennheiser EW-DX", "SKM", [...SENN_EVO, ...NEUMANN, "MM 435", "MM 445"]),
  ...bodypacks("ewdx-sk", "Sennheiser EW-DX", "SK"),
  ...wl("ewd", "Sennheiser EW-D", "SKM-S", [...SENN_EVO, ...NEUMANN, "MM 435", "MM 445"]),
  ...bodypacks("ewd-sk", "Sennheiser EW-D", "SK"),
  ...wl("d6000", "Sennheiser Digital 6000", "SKM 6000", [...SENN_EVO, ...NEUMANN, "MM 435", "MM 445", "MD 9235"]),
  ...bodypacks("d6000-sk", "Sennheiser Digital 6000", "SK 6000"),
  ...wl("g4", "Sennheiser ew G4", "SKM 100/300/500", SENN_EVO, ["MMD 935"]),
  ...wl("g4", "Sennheiser ew G4", "SKM 300/500", NEUMANN),
  ...bodypacks("g4-sk", "Sennheiser ew G4", "SK 100/300/500"),
];

/** since: 이 항목이 기본 목록에 들어온 판. 기존 저장본에는 그보다 새 항목만 합쳐 넣는다. */
type G = [id: string, name: string, color: Color, sources: S[], since?: number];
type Opt = { stereo?: boolean; numbered?: boolean; next?: string[] };
type S = [id: string, name: string, shortName: string, micIds: string[], opt?: Opt];

/** 기본 목록의 판. 기본 항목을 추가하면 올린다. (2: 국악 악기군, 3: 무선 시스템) */
export const SEED_VERSION = 3;

const ST: Opt = { stereo: true };
const NUM: Opt = { numbered: true };

const TOMS = ["mic-e604", "mic-e904", "mic-d2", "mic-beta98amp", "mic-md421"];
const SMALL_COND = ["mic-sm81", "mic-km184", "mic-c451b", "mic-nt5"];
const ACTIVE_DI = ["mic-j48", "mic-ar133", "mic-type85", "mic-jdi"];
const LINE_DI = ["mic-jdi", "mic-prodi", "mic-j48", "mic-ar133"];
const CHORUS = ["mic-sm58", "mic-beta58a", "mic-e935", "mic-e835"];
const STRINGS = ["mic-dpa4099", "mic-km184", "mic-c414"];

const GROUPS: G[] = [
  ["grp-drums", "드럼", "red", [
    ["src-kick-in", "Kick In", "KickIn", ["mic-beta91a", "mic-e901", "mic-beta52a", "mic-d6", "mic-d112"]],
    ["src-kick-out", "Kick Out", "KickOut", ["mic-beta52a", "mic-d6", "mic-d112", "mic-e902", "mic-re20"]],
    ["src-snare-top", "Snare Top", "SnTop", ["mic-sm57", "mic-beta57a", "mic-i5", "mic-e904"]],
    ["src-snare-btm", "Snare Btm", "SnBtm", ["mic-sm57", "mic-e604", "mic-beta98amp", "mic-beta57a"]],
    ["src-hihat", "Hi-Hat", "HH", ["mic-sm81", "mic-c451b", "mic-km184", "mic-nt5", "mic-e614"]],
    ["src-tom1", "Tom 1", "Tom1", TOMS],
    ["src-tom2", "Tom 2", "Tom2", TOMS],
    ["src-tom3", "Tom 3", "Tom3", TOMS],
    ["src-ftom", "Floor Tom", "FTom", ["mic-e904", "mic-d4", "mic-md421", "mic-e604"]],
    ["src-oh", "OH", "OH", ["mic-c414", "mic-km184", "mic-sm81", "mic-c451b", "mic-nt5"], ST],
    ["src-ride", "Ride", "Ride", SMALL_COND],
  ]],
  ["grp-perc", "퍼커션", "orange", [
    ["src-cajon", "Cajon", "Cajon", ["mic-beta91a", "mic-beta52a", "mic-d6", "mic-sm57"]],
    ["src-conga", "Conga", "Conga", ["mic-sm57", "mic-e604", "mic-beta98amp", "mic-md421"]],
    ["src-perc", "Perc", "Perc", SMALL_COND],
  ]],
  ["grp-bass", "베이스", "yellow", [
    ["src-bass-di", "Bass DI", "BassDI", ACTIVE_DI],
    ["src-bass-mic", "Bass Mic", "BassMic", ["mic-re20", "mic-beta52a", "mic-md421", "mic-d112"]],
  ]],
  ["grp-gtr", "기타", "green", [
    ["src-egtr1", "E.Gtr 1", "EGtr1", ["mic-sm57", "mic-e906", "mic-md421", "mic-r121", "mic-beta57a"]],
    ["src-egtr2", "E.Gtr 2", "EGtr2", ["mic-sm57", "mic-e906", "mic-md421", "mic-r121", "mic-beta57a"]],
    ["src-agtr-di", "A.Gtr DI", "AGtrDI", ACTIVE_DI],
    ["src-agtr-mic", "A.Gtr Mic", "AGtrMic", ["mic-km184", "mic-sm81", "mic-c451b", "mic-nt5"]],
  ]],
  ["grp-keys", "건반", "cyan", [
    ["src-keys", "Keys", "Keys", LINE_DI, ST],
    ["src-synth", "Synth", "Synth", LINE_DI, ST],
    ["src-piano", "Piano", "Piano", ["mic-c414", "mic-km184", "mic-dpa4099"], ST],
  ]],
  ["grp-vox", "보컬", "blue", [
    ["src-lead-vox", "Lead Vox", "LeadVox", ["mic-beta58a", "mic-sm58", "mic-e935", "mic-ksm9", "mic-kms105"]],
    ["src-cho1", "Chorus 1", "Cho1", CHORUS],
    ["src-cho2", "Chorus 2", "Cho2", CHORUS],
    ["src-cho3", "Chorus 3", "Cho3", CHORUS],
    ["src-cho4", "Chorus 4", "Cho4", CHORUS],
  ]],
  ["grp-brass", "관악", "purple", [
    ["src-tp", "Trumpet", "Tp", ["mic-md421", "mic-dpa4099", "mic-beta98hc", "mic-sm57"]],
    ["src-tb", "Trombone", "Tb", ["mic-md421", "mic-re20", "mic-dpa4099", "mic-sm57"]],
    ["src-sax", "Sax", "Sax", ["mic-md421", "mic-beta98hc", "mic-dpa4099", "mic-sm57"]],
  ]],
  ["grp-strings", "현악", "purple", [
    ["src-vn", "Violin", "Vn", STRINGS],
    ["src-va", "Viola", "Va", STRINGS],
    ["src-vc", "Cello", "Vc", ["mic-dpa4099", "mic-c414", "mic-km184"]],
    ["src-cb", "Contrabass", "Cb", ["mic-dpa4099", "mic-j48", "mic-c414", "mic-re20"]],
  ]],
  ["grp-choir", "합창", "white", [
    ["src-choir-oh", "Choir OH", "ChoOH", ["mic-km184", "mic-c414", "mic-sm81", "mic-nt5"], ST],
  ]],
  ["grp-play", "재생·MC", "white", [
    ["src-mr", "MR", "MR", LINE_DI, ST],
    ["src-mc1", "MC 1", "MC1", ["mic-ulxd-b58", "mic-ulxd-sm58", "mic-qlxd-b58", "mic-ew500-935"]],
    ["src-mc2", "MC 2", "MC2", ["mic-ulxd-b58", "mic-ulxd-sm58", "mic-qlxd-b58", "mic-ew500-935"]],
    ["src-tb-mic", "Talkback", "TB", ["mic-sm58", "mic-beta58a", "mic-e835"]],
  ]],
];


/*
 * 국악: 마이킹 표준이 정해진 게 아니라 현장 관행이다. 아래는 기본값일 뿐이고 내 라이브러리에서 고쳐 쓴다.
 * 추천에는 마이크 라이브러리에 이미 있는 모델만 넣는다.
 */
const GUGAK_STR = ["mic-dpa4099", "mic-km184", "mic-sm81", "mic-c451b"];
const GUGAK_FLUTE = ["mic-km184", "mic-sm81", "mic-sm57", "mic-dpa4099"];
const GUGAK_REED = ["mic-sm57", "mic-md421", "mic-re20"];
const GUGAK_DRUM = ["mic-sm57", "mic-e604", "mic-e904", "mic-md421"];
const GUGAK_BIG = ["mic-beta52a", "mic-d6", "mic-md421", "mic-sm57"];
const GUGAK_METAL = ["mic-sm81", "mic-km184"];
const GUGAK_VOX = ["mic-sm58", "mic-beta58a", "mic-ulxd-b58", "mic-kms105", "mic-beta87a"];

const GUGAK: G[] = [
  ["grp-gugak-str", "국악 현악", "brown", [
    ["src-gayageum", "가야금", "Gaya", GUGAK_STR, NUM],
    ["src-gayageum25", "25현 가야금", "25Gaya", [...GUGAK_STR, "mic-j48", "mic-ar133"]],
    ["src-geomungo", "거문고", "Geomungo", GUGAK_STR],
    ["src-daeajaeng", "대아쟁", "D.Ajaeng", GUGAK_STR],
    ["src-soajaeng", "소아쟁", "S.Ajaeng", GUGAK_STR],
    ["src-haegeum", "해금", "Haegeum", GUGAK_STR, NUM],
    ["src-yanggeum", "양금", "Yanggeum", GUGAK_STR],
  ], 2],
  ["grp-gugak-wind", "국악 관악", "lime", [
    ["src-daegeum", "대금", "Daegeum", GUGAK_FLUTE, NUM],
    ["src-sogeum", "소금", "Sogeum", GUGAK_FLUTE],
    ["src-danso", "단소", "Danso", GUGAK_FLUTE],
    ["src-piri", "피리", "Piri", GUGAK_REED, NUM],
    ["src-taepyeongso", "태평소", "Tpyeong", GUGAK_REED],
    ["src-saenghwang", "생황", "Saenghwa", GUGAK_FLUTE],
  ], 2],
  ["grp-gugak-perc", "국악 타악", "pink", [
    ["src-janggu-gung", "장구 궁편", "JangGung", GUGAK_DRUM, { numbered: true, next: ["src-janggu-chae"] }],
    ["src-janggu-chae", "장구 채편", "JangChae", GUGAK_DRUM, NUM],
    ["src-soribuk", "소리북", "SoriBuk", GUGAK_DRUM],
    ["src-pungmulbuk", "풍물북", "PungBuk", GUGAK_DRUM],
    ["src-kkwaenggwari", "꽹과리", "Kkwaeng", GUGAK_METAL],
    ["src-jing", "징", "Jing", GUGAK_METAL],
    ["src-daebuk", "대북", "Daebuk", GUGAK_BIG],
    ["src-modeumbuk", "모듬북", "Modeum", GUGAK_BIG, NUM],
  ], 2],
  ["grp-gugak-vox", "국악 성악", "gray", [
    ["src-sori", "소리", "Sori", GUGAK_VOX, { next: ["src-gosu", "src-soribuk"] }],
    ["src-minyo", "민요", "Minyo", GUGAK_VOX, NUM],
    ["src-jeongga", "정가", "Jeongga", GUGAK_VOX],
    ["src-gosu", "고수 추임새", "Gosu", ["mic-sm58", "mic-sm57"]],
  ], 2],
];

const ALL_GROUPS = [...GROUPS, ...GUGAK];

/** 48V 필요 여부를 확인하지 못해 비워둔 기본 모델 */
export const UNVERIFIED_MIC_IDS = MICS.filter((m) => m[3] === null).map((m) => m[0]);

function toSources(list: G[]): SourceDef[] {
  return list.flatMap(([groupId, , color, srcs]) =>
    srcs.map(([id, name, shortName, micIds, opt = {}]) => ({
      id,
      name,
      shortName,
      groupId,
      color,
      stereo: !!opt.stereo,
      numbered: !!opt.numbered,
      micIds: [...micIds],
      next: [...(opt.next ?? [])],
    })),
  );
}

export function createDefaultLibrary(): Library {
  const microphones: LibraryMic[] = [...MICS, ...WIRELESS].map(([id, model, type, needsPhantom, defaultStand]) => ({
    id,
    model,
    type,
    needsPhantom,
    defaultStand,
    owned: null,
    builtin: true,
  }));
  return {
    schemaVersion: LIBRARY_VERSION,
    seedVersion: SEED_VERSION,
    microphones,
    groups: ALL_GROUPS.map(([id, name]) => ({ id, name })),
    sources: toSources(ALL_GROUPS),
    blockTemplates: [],
    showTemplates: [],
  };
}

/**
 * 이미 저장된 내 라이브러리에 새 판의 기본 항목을 합쳐 넣는다.
 * 저장본에 없는 악기군·소스만 추가하고, 기존 항목(내가 고친 소스, 보유 수량, 추천 순서)은 그대로 둔다.
 * 예전에 내가 지운 기본 항목은 그 판 이전 것이므로 다시 생기지 않는다.
 */
export function upgradeLibrary(lib: Library): Library {
  if (lib.seedVersion >= SEED_VERSION) return lib;
  const newer = ALL_GROUPS.filter(([, , , , since = 1]) => since > lib.seedVersion);
  const groupIds = new Set(lib.groups.map((g) => g.id));
  const srcIds = new Set(lib.sources.map((s) => s.id));
  // 새 판의 기본 마이크: 같은 id나 같은 모델 이름이 이미 있으면(내가 직접 넣은 것 포함) 넣지 않는다
  const models = new Set(lib.microphones.map((m) => norm(m.model)));
  const newMics: LibraryMic[] = (lib.seedVersion < WIRELESS_SINCE ? WIRELESS : [])
    .filter(([id, model]) => !lib.microphones.some((m) => m.id === id) && !models.has(norm(model)))
    .map(([id, model, type, needsPhantom, defaultStand]) => ({ id, model, type, needsPhantom, defaultStand, owned: null, builtin: true }));
  const micIds = new Set([...lib.microphones, ...newMics].map((m) => m.id));
  const added = toSources(newer)
    .filter((s) => !srcIds.has(s.id))
    .map((s) => ({ ...s, micIds: s.micIds.filter((id) => micIds.has(id)) }));
  return {
    ...lib,
    seedVersion: SEED_VERSION,
    microphones: [...lib.microphones, ...newMics],
    groups: [...lib.groups, ...newer.filter(([id]) => !groupIds.has(id)).map(([id, name]) => ({ id, name }))],
    sources: [...lib.sources, ...added],
  };
}
