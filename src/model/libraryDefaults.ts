/**
 * 처음 쓸 때 내 라이브러리에 채워 넣는 기본값.
 * - 마이크/DI: 현장에서 흔한 모델. 48V 필요 여부를 확신할 수 없는 모델은 null(미확인)로 둔다.
 * - 소스: 악기군별 기본 목록과 소스별 추천 마이크(앞에 있을수록 우선).
 * 기본 스탠드는 사양이 아니라 흔한 용도 기준의 출발값이다.
 */
import type { Color, MicType } from "./schema";
import { LIBRARY_VERSION, type Library, type LibraryMic, type SourceDef } from "./library";

type M = [id: string, model: string, type: MicType, phantom: boolean | null, stand: string];

const D = "dynamic";
const C = "condenser";
const R = "ribbon";
const DI = "di";
const W = "wireless";

const MICS: M[] = [
  // Shure
  ["mic-sm58", "Shure SM58", D, false, "톨붐"],
  ["mic-beta58a", "Shure Beta 58A", D, false, "톨붐"],
  ["mic-sm57", "Shure SM57", D, false, "숏붐"],
  ["mic-beta57a", "Shure Beta 57A", D, false, "숏붐"],
  ["mic-beta52a", "Shure Beta 52A", D, false, "숏붐"],
  ["mic-beta91a", "Shure Beta 91A", C, true, ""],
  ["mic-beta56a", "Shure Beta 56A", D, false, "클램프"],
  ["mic-beta98amp", "Shure Beta 98AMP", C, true, "클램프"],
  ["mic-beta98hc", "Shure Beta 98H/C", C, true, ""],
  ["mic-beta87a", "Shure Beta 87A", C, true, "톨붐"],
  ["mic-sm81", "Shure SM81", C, true, "숏붐"],
  ["mic-ksm9", "Shure KSM9", C, true, "톨붐"],
  ["mic-ksm32", "Shure KSM32", C, true, "톨붐"],
  ["mic-ksm137", "Shure KSM137", C, true, "숏붐"],
  ["mic-sm7b", "Shure SM7B", D, false, "톨붐"],
  // Sennheiser
  ["mic-e835", "Sennheiser e835", D, false, "톨붐"],
  ["mic-e935", "Sennheiser e935", D, false, "톨붐"],
  ["mic-e945", "Sennheiser e945", D, false, "톨붐"],
  ["mic-e965", "Sennheiser e965", C, true, "톨붐"],
  ["mic-e604", "Sennheiser e604", D, false, "클램프"],
  ["mic-e904", "Sennheiser e904", D, false, "클램프"],
  ["mic-e906", "Sennheiser e906", D, false, "숏붐"],
  ["mic-e901", "Sennheiser e901", C, true, ""],
  ["mic-e902", "Sennheiser e902", D, false, "숏붐"],
  ["mic-e614", "Sennheiser e614", C, true, "숏붐"],
  ["mic-md421", "Sennheiser MD 421-II", D, false, "숏붐"],
  ["mic-md441", "Sennheiser MD 441-U", D, false, "숏붐"],
  // AKG
  ["mic-d112", "AKG D112 MkII", D, false, "숏붐"],
  ["mic-c414", "AKG C414 XLS", C, true, "톨붐"],
  ["mic-c451b", "AKG C451 B", C, true, "숏붐"],
  ["mic-c214", "AKG C214", C, true, "톨붐"],
  // Audix
  ["mic-d6", "Audix D6", D, false, "숏붐"],
  ["mic-d2", "Audix D2", D, false, "클램프"],
  ["mic-d4", "Audix D4", D, false, "클램프"],
  ["mic-i5", "Audix i5", D, false, "숏붐"],
  // 그 외 마이크
  ["mic-re20", "Electro-Voice RE20", D, false, "숏붐"],
  ["mic-km184", "Neumann KM 184", C, true, "톨붐"],
  ["mic-kms105", "Neumann KMS 105", C, true, "톨붐"],
  ["mic-tlm103", "Neumann TLM 103", C, true, "톨붐"],
  ["mic-nt5", "Rode NT5", C, true, "톨붐"],
  ["mic-dpa4099", "DPA 4099", C, true, ""],
  ["mic-dpa4018v", "DPA 4018V", C, true, "톨붐"],
  ["mic-r121", "Royer R-121", R, false, "숏붐"],
  ["mic-m88", "Beyerdynamic M 88 TG", D, false, "톨붐"],
  ["mic-m201", "Beyerdynamic M 201 TG", D, false, "숏붐"],
  ["mic-at4050", "Audio-Technica AT4050", C, true, "톨붐"],
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

type G = [id: string, name: string, color: Color, sources: S[]];
type S = [id: string, name: string, shortName: string, micIds: string[], stereo?: "stereo"];

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
    ["src-oh", "OH", "OH", ["mic-c414", "mic-km184", "mic-sm81", "mic-c451b", "mic-nt5"], "stereo"],
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
    ["src-keys", "Keys", "Keys", LINE_DI, "stereo"],
    ["src-synth", "Synth", "Synth", LINE_DI, "stereo"],
    ["src-piano", "Piano", "Piano", ["mic-c414", "mic-km184", "mic-dpa4099"], "stereo"],
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
    ["src-choir-oh", "Choir OH", "ChoOH", ["mic-km184", "mic-c414", "mic-sm81", "mic-nt5"], "stereo"],
  ]],
  ["grp-play", "재생·MC", "white", [
    ["src-mr", "MR", "MR", LINE_DI, "stereo"],
    ["src-mc1", "MC 1", "MC1", ["mic-ulxd-b58", "mic-ulxd-sm58", "mic-qlxd-b58", "mic-ew500-935"]],
    ["src-mc2", "MC 2", "MC2", ["mic-ulxd-b58", "mic-ulxd-sm58", "mic-qlxd-b58", "mic-ew500-935"]],
    ["src-tb-mic", "Talkback", "TB", ["mic-sm58", "mic-beta58a", "mic-e835"]],
  ]],
];

/** 48V 필요 여부를 확인하지 못해 비워둔 기본 모델 */
export const UNVERIFIED_MIC_IDS = MICS.filter((m) => m[3] === null).map((m) => m[0]);

export function createDefaultLibrary(): Library {
  const microphones: LibraryMic[] = MICS.map(([id, model, type, needsPhantom, defaultStand]) => ({
    id,
    model,
    type,
    needsPhantom,
    defaultStand,
    owned: null,
    builtin: true,
  }));
  const sources: SourceDef[] = GROUPS.flatMap(([groupId, , color, list]) =>
    list.map(([id, name, shortName, micIds, stereo]) => ({
      id,
      name,
      shortName,
      groupId,
      color,
      stereo: stereo === "stereo",
      micIds: [...micIds],
    })),
  );
  return {
    schemaVersion: LIBRARY_VERSION,
    microphones,
    groups: GROUPS.map(([id, name]) => ({ id, name })),
    sources,
  };
}
