/**
 * Yamaha DM7 쇼 파일 → 콘솔 상태(ConsoleSnapshot) 읽기. 내보내기(dm7Export.ts)의 반대 방향.
 * 읽는 것: 인풋 이름·컬러·패치·48V·페어·DCA·뮤트 배정, 아웃풋 패치, Mix·Matrix·Stereo·DCA·뮤트 이름,
 * Mix·Matrix의 스테레오(Signal/Relation, 실제 공연 파일에서 확인).
 * 위치는 모두 파일 안 스키마로 계산한다. 스냅샷은 기종 중립 모양이라 Show 만들기·비교는 src/export/importShow.ts.
 */
import type { BusKind, Color, PortRef, StageBox } from "@/model/schema";
import { blockData, findBlock, type Dm7File } from "./container";
import { locate, parseSections, readBit, readString, readUint, section, type MbdfSection } from "./mbdf";
import { DANTE_BASE, MATRIX_BASE, MIX_BASE, OMNI_BASE, sourceLabel, STEREO_A, STEREO_B, type Dm7BoxSetting } from "./dm7Export";
import { profileByModel, type ConsoleProfile } from "../profile";

export interface SnapshotChannel {
  number: number;
  name: string;
  /** OnePatch 컬러 (콘솔 컬러를 되돌린 것) */
  color: Color;
  /** 파일의 컬러 값 */
  colorValue: string;
  port: PortRef | null;
  /** 파일의 패치 표시 (Dante 9, OMNI 3, 없음 …) */
  portLabel: string;
  /** 패치를 Show로 옮기지 못한 이유 (박스 범위 밖 Dante, 알 수 없는 소스) */
  portIssue?: "dante-range" | "unknown";
  /** 48V (포트를 알 수 없으면 null) */
  phantom: boolean | null;
  pairNext: boolean;
  dca: number[];
  mute: number[];
  /** 기본 이름(ch 1, ch10 …) 그대로 */
  isDefault: boolean;
}

export interface SnapshotBus {
  kind: BusKind;
  /** 콘솔 쪽 번호 (Mix 3, Matrix 1, Stereo A = 1 / B = 2). 스테레오는 앞 번호 */
  consoleNumber: number;
  /** 표시용 (Mix 3/4, Stereo A …) */
  label: string;
  name: string;
  width: "mono" | "stereo";
  /** 스테레오면 [L, R] (각 첫 출력) */
  ports: PortRef[];
  isDefault: boolean;
}

export interface ConsoleSnapshot {
  modelName: string;
  profile: ConsoleProfile;
  channels: SnapshotChannel[];
  buses: SnapshotBus[];
  dcas: { number: number; name: string; isDefault: boolean }[];
  mutes: { number: number; name: string; isDefault: boolean }[];
  /** 읽었지만 Show로 옮길 수 없는 것 (채널 패치는 SnapshotChannel.portIssue, 묶음 안내는 importShow.channelNotes) */
  notes: string[];
}

/** DM7 기본 이름 (basic·실제 공연 파일에서 관찰: "ch 1"·"ch10", "MX 1", "MT 1"/"MT 10", "ST A", "DCA 1", "Mute 1") */
const DEFAULT_NAME: Record<string, RegExp> = {
  ch: /^ch ?\d+$/i,
  Mix: /^MX ?\d+$/,
  Matrix: /^MT ?\d+$/,
  Stereo: /^ST [AB]$/,
  DCA: /^DCA ?\d+$/,
  Mute: /^Mute ?\d+$/,
};

/** 콘솔 컬러 → OnePatch 컬러 (가까운 색으로 바꿨던 것은 되돌리지 않고 원래 색) */
function colorBack(P: ConsoleProfile, value: string): Color {
  for (const [k, v] of Object.entries(P.colorMap)) if (v.value === value && !v.approx) return k as Color;
  return "none";
}

export function readDm7(file: Dm7File, stageBoxes: readonly StageBox[], boxes: Record<string, Dm7BoxSetting>): ConsoleSnapshot {
  const block = findBlock(file, "CurrentBackupFile.bup");
  if (!block) throw new Error("파일에서 현재 설정(CurrentBackupFile.bup)을 찾지 못했습니다.");
  const cur = blockData(block);
  const secs = parseSections(cur);
  const mixing = section(secs, "Mixing");
  const processing = section(secs, "Processing");
  const P = profileByModel(file.model);
  const notes: string[] = [];
  const str = (sec: MbdfSection, steps: Parameters<typeof locate>[1]) => readString(cur, locate(sec, steps)).trim();

  /* 인풋 패치 → 포트 */
  const inPort = (v: number): { port: PortRef | null; issue?: SnapshotChannel["portIssue"] } => {
    if (v >= OMNI_BASE && v < OMNI_BASE + 0x100) return { port: { kind: "local", port: v - OMNI_BASE + 1 } };
    if (v >= DANTE_BASE && v < DANTE_BASE + 0x1000) {
      const n = v - DANTE_BASE + 1;
      for (const b of stageBoxes) {
        const start = boxes[b.id]?.danteStart;
        if (start && n >= start && n < start + b.inputs) return { port: { kind: "stagebox", stageBoxId: b.id, port: n - start + 1 } };
      }
      return { port: null, issue: "dante-range" };
    }
    return { port: null, issue: v ? "unknown" : undefined };
  };
  const phantomOf = (port: PortRef | null): boolean | null => {
    if (!port || port.kind === "other" || port.kind === "dante") return null;
    if (port.kind === "local") return readBit(cur, locate(processing, ["Omni", ["InputPort", port.port - 1], "HeadAmp", "48V"]));
    const unit = boxes[port.stageBoxId]?.ioUnit;
    if (!unit) return null;
    return readBit(cur, locate(mixing, ["DanteRemoteControl", ["IOUnit", unit - 1], ["InputPort", port.port - 1], "HeadAmp", "48V"]));
  };

  const count = Math.min(P.inputs, locate(mixing, ["InputChannel"]).node.count);
  const channels: SnapshotChannel[] = [];
  for (let n = 1; n <= count; n++) {
    const ch = (...s: Parameters<typeof locate>[1]) => locate(mixing, [["InputChannel", n - 1], ...s]);
    const name = readString(cur, ch("Label", "Name")).trim();
    const colorValue = readString(cur, ch("Label", "Color")).trim();
    const bank = readBit(cur, ch("InPatch", "Select")) ? 1 : 0;
    const src = readUint(cur, locate(mixing, [["InputChannel", n - 1], "InPatch", ["Bank", bank], "Source"]));
    const { port, issue } = inPort(src);
    const bits = (f: ReturnType<typeof locate>, max: number) =>
      Array.from({ length: Math.min(max, f.node.count) }, (_, i) => (readBit(cur, f, i) ? i + 1 : 0)).filter(Boolean);
    channels.push({
      number: n,
      name,
      color: colorBack(P, colorValue),
      colorValue,
      port,
      portLabel: sourceLabel(src),
      portIssue: issue,
      phantom: phantomOf(port),
      pairNext: readUint(cur, ch("Signal", "Relation")) === 0x80,
      dca: bits(ch("DCA", "Assign"), P.dcas),
      mute: bits(ch("MuteGroup", "Assign"), P.muteGroups),
      isDefault: DEFAULT_NAME.ch.test(name),
    });
  }

  /* 아웃풋 패치: 소스 → 출력 포트들 */
  const outs = new Map<number, PortRef[]>();
  const addOut = (source: number, p: PortRef) => outs.set(source, [...(outs.get(source) ?? []), p]);
  const omniOut = locate(processing, ["Omni", "OutputPort"]).node.count;
  for (let i = 0; i < omniOut; i++) {
    const v = readUint(cur, locate(processing, ["Omni", ["OutputPort", i], "Patch", "Source"]));
    if (v) addOut(v, { kind: "local", port: i + 1 });
  }
  const danteOut = locate(processing, ["Dante", "OutputPort"]).node.count;
  for (let i = 0; i < danteOut; i++) {
    const v = readUint(cur, locate(processing, ["Dante", ["OutputPort", i], "Patch", "Source"]));
    if (!v) continue;
    const n = i + 1;
    const box = stageBoxes.find((b) => {
      const s = boxes[b.id]?.danteOutStart;
      return s && n >= s && n < s + b.outputs;
    });
    if (box) addOut(v, { kind: "stagebox", stageBoxId: box.id, port: n - boxes[box.id]!.danteOutStart! + 1 });
  }

  /* Mix·Matrix: Signal/Relation 0x80(L)·0x01(R)이면 스테레오. 없으면 짝수 번과 이름이 같을 때(OnePatch가 내보낸 파일) */
  const buses: SnapshotBus[] = [];
  const busKind = (coll: "Mix" | "Matrix", kind: BusKind, base: number, max: number) => {
    const total = Math.min(max, locate(mixing, [coll]).node.count);
    const name = (i: number) => str(mixing, [[coll, i], "Label", "Name"]);
    const rel = (i: number) => {
      try {
        return readUint(cur, locate(mixing, [[coll, i], "Signal", "Relation"]));
      } catch {
        return 0;
      }
    };
    for (let i = 0; i < total; i++) {
      const a = name(i);
      const stereo =
        i % 2 === 0 &&
        i + 1 < total &&
        ((rel(i) === 0x80 && rel(i + 1) === 0x01) || (a === name(i + 1) && !DEFAULT_NAME[coll].test(a)));
      if (stereo) {
        const b = name(i + 1);
        // "IEM1 L"/"IEM1 R" → "IEM1"
        const lr = a.match(/^(.*\S)\s*L$/i);
        const merged = a === b ? a : lr && b.match(/^(.*\S)\s*R$/i)?.[1] === lr[1] ? lr[1] : a;
        const ports = [outs.get(base + i)?.[0], outs.get(base + i + 1)?.[0]].filter((p): p is PortRef => !!p);
        buses.push({ kind, consoleNumber: i + 1, label: `${coll} ${i + 1}/${i + 2}`, name: merged, width: "stereo", ports, isDefault: DEFAULT_NAME[coll].test(a) && DEFAULT_NAME[coll].test(b) });
        i++;
      } else {
        buses.push({ kind, consoleNumber: i + 1, label: `${coll} ${i + 1}`, name: a, width: "mono", ports: outs.get(base + i) ?? [], isDefault: DEFAULT_NAME[coll].test(a) });
      }
    }
  };
  busKind("Mix", "aux", MIX_BASE, P.mixes);
  busKind("Matrix", "matrix", MATRIX_BASE, P.matrices);
  for (const [k, label, src, idx] of [[1, "Stereo A", STEREO_A, 0], [2, "Stereo B", STEREO_B, 2]] as const) {
    const name = str(mixing, [["Stereo", idx], "Label", "Name"]);
    const ports = [outs.get(src)?.[0], outs.get(src + 1)?.[0]].filter((p): p is PortRef => !!p);
    buses.push({ kind: "main", consoleNumber: k, label, name, width: k === 1 || ports.length > 1 ? "stereo" : "mono", ports, isDefault: DEFAULT_NAME.Stereo.test(name) });
  }

  const named = (coll: "DCA" | "Mute", max: number) =>
    Array.from({ length: Math.min(max, locate(mixing, [coll]).node.count) }, (_, i) => {
      const name = str(mixing, [[coll, i], "Label", "Name"]);
      return { number: i + 1, name, isDefault: DEFAULT_NAME[coll].test(name) };
    });

  return { modelName: P.name, profile: P, channels, buses, dcas: named("DCA", P.dcas), mutes: named("Mute", P.muteGroups), notes };
}
