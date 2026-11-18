/**
 * 샘플: 5인조 밴드 (드럼, 베이스, 기타+보컬, 키보드+보컬, 메인 보컬)
 * CL5 + Rio3224(하수) + Rio1608(상수, 키보드 쪽 서브스네이크) 기준.
 */
import { newId } from "@/model/factory";
import {
  SCHEMA_VERSION,
  type BusKind,
  type BusPurpose,
  type Color,
  type InputChannel,
  type Microphone,
  type OutputBus,
  type PortRef,
  type Show,
} from "@/model/schema";

const SL = "box-rio3224";
const SR = "box-rio1608";
const sl = (port: number): PortRef => ({ kind: "stagebox", stageBoxId: SL, port });
const sr = (port: number): PortRef => ({ kind: "stagebox", stageBoxId: SR, port });
const local = (port: number): PortRef => ({ kind: "local", port });

const mic = (
  id: string,
  model: string,
  type: Microphone["type"],
  needsPhantom: boolean,
  defaultStand: string,
): Microphone => ({ id, model, type, needsPhantom, defaultStand });

const microphones: Microphone[] = [
  mic("mic-beta91a", "Shure Beta 91A", "condenser", true, ""),
  mic("mic-beta52a", "Shure Beta 52A", "dynamic", false, "숏붐"),
  mic("mic-sm57", "Shure SM57", "dynamic", false, "숏붐"),
  mic("mic-sm58", "Shure SM58", "dynamic", false, "톨붐"),
  mic("mic-sm81", "Shure SM81", "condenser", true, "숏붐"),
  mic("mic-e604", "Sennheiser e604", "dynamic", false, "클램프"),
  mic("mic-e906", "Sennheiser e906", "dynamic", false, ""),
  mic("mic-md421", "Sennheiser MD421", "dynamic", false, "숏붐"),
  mic("mic-km184", "Neumann KM184", "condenser", true, "톨붐"),
  mic("mic-j48", "Radial J48", "di", true, ""),
  mic("mic-prod2", "Radial ProD2", "di", false, ""),
  mic("mic-ulxd-b58", "Shure ULXD2/B58", "wireless", false, ""),
];

const DCA = { drums: "dca-1", bass: "dca-2", gtr: "dca-3", keys: "dca-4", vox: "dca-5" };
const MG = { band: "mg-1", vox: "mg-2", mc: "mg-3" };

type Row = [
  number: number,
  source: string,
  shortName: string,
  performer: string,
  micId: string | null,
  port: PortRef,
  color: Color,
  dca: string,
  mute: string,
  opts?: Partial<InputChannel>,
];

const rows: Row[] = [
  [1, "Kick In", "Kick In", "Drums", "mic-beta91a", sl(1), "red", DCA.drums, MG.band],
  [2, "Kick Out", "Kick Out", "Drums", "mic-beta52a", sl(2), "red", DCA.drums, MG.band],
  [3, "Snare Top", "SN Top", "Drums", "mic-sm57", sl(3), "red", DCA.drums, MG.band],
  [4, "Snare Bottom", "SN Btm", "Drums", "mic-sm57", sl(4), "red", DCA.drums, MG.band, { notes: "위상 반전" }],
  [5, "Hi-Hat", "HH", "Drums", "mic-sm81", sl(5), "red", DCA.drums, MG.band],
  [6, "Rack Tom", "Tom 1", "Drums", "mic-e604", sl(6), "red", DCA.drums, MG.band],
  [7, "Floor Tom 1", "FTom 1", "Drums", "mic-e604", sl(7), "red", DCA.drums, MG.band],
  [8, "Floor Tom 2", "FTom 2", "Drums", "mic-e604", sl(8), "red", DCA.drums, MG.band],
  [9, "Overhead L", "OH L", "Drums", "mic-km184", sl(9), "red", DCA.drums, MG.band, { stereoLinkNext: true }],
  [10, "Overhead R", "OH R", "Drums", "mic-km184", sl(10), "red", DCA.drums, MG.band],
  [11, "Bass DI", "Bass DI", "Bass", "mic-j48", sl(11), "orange", DCA.bass, MG.band, { notes: "앰프 스루 DI" }],
  [12, "Bass Amp", "Bass Mic", "Bass", "mic-md421", sl(12), "orange", DCA.bass, MG.band],
  [13, "Electric Guitar", "E.Gtr", "Gt./Vo.", "mic-sm57", sl(13), "yellow", DCA.gtr, MG.band, { stand: "", notes: "앰프 그릴에 걸기" }],
  [14, "Electric Guitar 2", "E.Gtr 2", "Gt./Vo.", "mic-e906", sl(14), "yellow", DCA.gtr, MG.band],
  [15, "Acoustic Guitar", "Ac.Gtr", "Gt./Vo.", "mic-j48", sl(15), "yellow", DCA.gtr, MG.band],
  [16, "Keys 1 L", "Keys L", "Keys/Vo.", "mic-prod2", sr(1), "green", DCA.keys, MG.band, { stereoLinkNext: true }],
  [17, "Keys 1 R", "Keys R", "Keys/Vo.", "mic-prod2", sr(2), "green", DCA.keys, MG.band],
  [18, "Synth L", "Syn L", "Keys/Vo.", "mic-prod2", sr(3), "green", DCA.keys, MG.band, { stereoLinkNext: true }],
  [19, "Synth R", "Syn R", "Keys/Vo.", "mic-prod2", sr(4), "green", DCA.keys, MG.band],
  [20, "Lead Vocal", "Lead Vo", "Vocal", "mic-ulxd-b58", sl(17), "cyan", DCA.vox, MG.vox, { notes: "무선 1 / 스페어 무선 2" }],
  [21, "Guitar Vocal", "Gt Vo", "Gt./Vo.", "mic-sm58", sl(18), "cyan", DCA.vox, MG.vox],
  [22, "Keys Vocal", "Keys Vo", "Keys/Vo.", "mic-sm58", sr(5), "cyan", DCA.vox, MG.vox],
  [23, "Bass Chorus", "Bass Vo", "Bass", "mic-sm58", sl(19), "cyan", DCA.vox, MG.vox],
  [24, "MC", "MC", "MC", "mic-ulxd-b58", sl(20), "blue", DCA.vox, MG.mc, { notes: "무선 3" }],
  [25, "Talkback", "TB", "FOH", "mic-sm58", local(1), "white", "", "", { stand: "데스크 스탠드" }],
];

const inputs: InputChannel[] = rows.map(
  ([number, source, shortName, performer, micId, port, color, dca, mute, opts]) => ({
    id: `ch-${number}`,
    number,
    source,
    shortName,
    performer,
    mic: micId ? { kind: "library", microphoneId: micId } : null,
    stand: null,
    phantom: null,
    port,
    stereoLinkNext: false,
    color,
    dcaIds: dca ? [dca] : [],
    muteGroupIds: mute ? [mute] : [],
    notes: "",
    ...opts,
  }),
);

const bus = (
  kind: BusKind,
  number: number,
  name: string,
  purpose: BusPurpose,
  width: OutputBus["width"],
  tap: OutputBus["tap"],
  ports: PortRef[],
  notes = "",
): OutputBus => ({
  id: `bus-${kind}-${number}`,
  kind,
  number,
  name,
  purpose,
  width,
  tap,
  ports,
  notes,
});

const outputs: OutputBus[] = [
  bus("aux", 1, "Lead Vo Wedge", "wedge", "mono", "pre", [sl(1)], "웨지 2통 데이지체인"),
  bus("aux", 2, "Gtr Wedge", "wedge", "mono", "pre", [sl(2)]),
  bus("aux", 3, "Bass Wedge", "wedge", "mono", "pre", [sl(3)]),
  bus("aux", 4, "Keys Wedge", "wedge", "mono", "pre", [sr(1)]),
  bus("aux", 5, "Drum IEM", "iem", "stereo", "pre", [sl(5), sl(6)], "유선 IEM"),
  bus("aux", 6, "Lead Vo IEM", "iem", "stereo", "pre", [sl(7), sl(8)], "PSM1000 ch.1"),
  bus("aux", 7, "Side Fill", "sidefill", "stereo", "pre", [sl(9), sl(10)]),
  bus("aux", 8, "FX1 Rev", "fx", "stereo", "post", [], "내부 이펙트"),
  bus("aux", 9, "FX2 Dly", "fx", "stereo", "post", [], "내부 이펙트, 탭 템포"),
  bus("matrix", 1, "Front Fill", "frontfill", "mono", "post", [sl(11)]),
  bus("matrix", 2, "Delay", "delay", "stereo", "post", [sl(12), sl(13)], "딜레이 타워 18m"),
  bus("matrix", 3, "Rec", "record", "stereo", "post", [local(1), local(2)]),
  bus("main", 1, "Main LR", "pa", "stereo", "post", [sl(15), sl(16)], "Lake 프로세서로"),
];

export function createSampleShow(): Show {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title: "샘플 — 5인조 밴드 단독 공연",
    date: "2026-12-24",
    venue: "OO아트홀 대극장",
    author: "FOH",
    version: "v1",
    notes: "샘플 데이터입니다. 리허설 15:00, 공연 19:30.",
    createdAt: now,
    updatedAt: now,
    stageBoxes: [
      { id: SL, name: "Rio3224", inputs: 32, outputs: 16, location: "무대 하수(SL)" },
      { id: SR, name: "Rio1608", inputs: 16, outputs: 8, location: "무대 상수(SR) 키보드 옆" },
    ],
    microphones,
    dcas: [
      { id: DCA.drums, number: 1, name: "Drums" },
      { id: DCA.bass, number: 2, name: "Bass" },
      { id: DCA.gtr, number: 3, name: "Gtr" },
      { id: DCA.keys, number: 4, name: "Keys" },
      { id: DCA.vox, number: 5, name: "Vox" },
    ],
    muteGroups: [
      { id: MG.band, number: 1, name: "Band" },
      { id: MG.vox, number: 2, name: "Vox" },
      { id: MG.mc, number: 3, name: "MC" },
    ],
    inputs,
    outputs,
  };
}
