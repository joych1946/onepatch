/** 5번: 스테이지박스 포트를 자유롭게 (아무 박스·아무 포트, 박스 없는 포트, 박스 변경에도 패치 유지) */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { COLUMNS, COL_INDEX } from "@/model/inputColumns";
import { formatPort } from "@/model/labels";
import { boxColumns, boxOps, boxRemovalLoss, boxUsage, freePorts, OMNI_BOX, swapPorts, DANTE_BOX } from "@/model/patch";
import { checkShow, type Show } from "@/model/schema";
import { parseShow } from "@/model/serialize";
import { parseDm7File } from "@/export/dm7/container";
import { defaultDm7Options, planDm7, type Dm7Item } from "@/export/dm7/dm7Export";

const portCol = COLUMNS[COL_INDEX.port];
const setBoxCell = (s: Show, row: number, key: string, text: string) => boxColumns().find((c) => c.key === key)!.set(s, row, text)!;
const portText = (s: Show, i: number) => formatPort(s.inputs[i].port, s.stageBoxes);

describe("스테이지박스 포트 자유 설정 (5번)", () => {
  it("인풋 13개짜리 박스를 만들고 채널 1을 그 박스 13번에 패치", () => {
    let s = boxOps.append(createSampleShow());
    const row = s.stageBoxes.length - 1;
    s = setBoxCell(s, row, "name", "Stage 13");
    s = setBoxCell(s, row, "inputs", "13");
    s = setBoxCell(s, row, "outputs", "3");
    expect(s.stageBoxes[row]).toMatchObject({ name: "Stage 13", inputs: 13, outputs: 3 });
    s = portCol.set(s, 0, "Stage 13 13")!;
    expect(portText(s, 0)).toBe("Stage 13 13");
    expect(checkShow(s).warnings.filter((w) => w.path[0] === "inputs" && w.path[1] === 0)).toEqual([]);
    // 순서와 상관없이: 채널 2를 첫 박스 30번에
    s = portCol.set(s, 1, "Rio3224 30")!;
    expect(portText(s, 1)).toBe("Rio3224 30");
  });

  it("박스 없는 포트: 콘솔 본체(OMNI)와 Dante 직결", () => {
    let s = createSampleShow();
    s = portCol.set(s, 0, "OMNI 3")!;
    expect(s.inputs[0].port).toEqual({ kind: "local", port: 3 });
    s = portCol.set(s, 1, "Dante 40")!;
    expect(s.inputs[1].port).toEqual({ kind: "dante", port: 40 });
    expect(portText(s, 1)).toBe("Dante 40");
    s = portCol.set(s, 2, "L5")!; // 예전 표기
    expect(portText(s, 2)).toBe("OMNI 5");
    expect(parseShow(JSON.parse(JSON.stringify(s))).ok).toBe(true);
    // 같은 Dante 번호를 두 채널이 쓰면 경고
    s = portCol.set(s, 3, "dante 40")!;
    expect(checkShow(s).warnings.some((w) => w.code === "dup-in-port")).toBe(true);
  });

  it("빈 포트 후보: 박스별 빈 포트 + OMNI", () => {
    const s = createSampleShow();
    const list = freePorts(s, "in").map((p) => formatPort(p, s.stageBoxes));
    expect(list).not.toContain("Rio3224 1"); // 쓰는 중
    expect(list.some((p) => p.startsWith("OMNI "))).toBe(true);
    expect(list).toContain("OMNI 16");
    expect(portCol.suggestions!(s)).toEqual(list);
  });

  it("현황판에서 박스 사이, 박스 ↔ OMNI로 옮기기", () => {
    const s0 = createSampleShow();
    const [a, b] = s0.stageBoxes;
    let s = swapPorts(s0, { dir: "in", boxId: a.id, port: 1 }, { dir: "in", boxId: b.id, port: 16 });
    expect(portText(s, 0)).toBe(`${b.name} 16`);
    s = swapPorts(s, { dir: "in", boxId: b.id, port: 16 }, { dir: "in", boxId: OMNI_BOX, port: 2 });
    expect(portText(s, 0)).toBe("OMNI 2");
    expect(boxUsage(s, OMNI_BOX).ins.get(2)).toEqual([{ channelIndex: 0 }]);
    s = swapPorts(s, { dir: "in", boxId: OMNI_BOX, port: 2 }, { dir: "in", boxId: DANTE_BOX, port: 9 });
    expect(portText(s, 0)).toBe("Dante 9");
  });

  it("박스 이름·위치·순서를 바꿔도 패치 유지, 지우면 비워질 패치를 미리 알려 줌", () => {
    let s = createSampleShow();
    const before = s.inputs.map((_, i) => s.inputs[i].port);
    s = setBoxCell(s, 0, "name", "SL Rio");
    s = setBoxCell(s, 0, "location", "무대 하수");
    s = boxOps.move(s, 0, 0, 2, false).show;
    expect(s.inputs.map((c) => c.port)).toEqual(before);
    expect(portText(s, 0)).toBe("SL Rio 1");
    const id = s.stageBoxes.find((b) => b.name === "SL Rio")!.id;
    const loss = boxRemovalLoss(s, [id]);
    expect(loss.length).toBeGreaterThan(0);
    expect(loss[0]).toMatch(/^Ch 1 .*\(SL Rio 1\)$/);
    expect(loss.some((l) => l.startsWith("Aux 1 "))).toBe(true);
    // 빈 박스는 알릴 것이 없다
    const empty = boxOps.append(s);
    expect(boxRemovalLoss(empty, [empty.stageBoxes.at(-1)!.id])).toEqual([]);
  });
});

const DIR = process.env.DM7_SAMPLES ?? join(homedir(), "Documents/vender/dm7");
const BASIC = join(DIR, "basic.dm7f.dmxf");
const none: Record<Dm7Item, boolean> = { name: false, color: false, icon: false, patch: false, phantom: false, pair: false, dca: false, mute: false, outPatch: false, busNames: false };

describe.skipIf(!existsSync(BASIC))("DM7 내보내기: 박스 없는 포트 (샘플 필요)", () => {
  it("Dante 직결 인풋 → Dante n, OMNI → OMNI n, Dante 직결 출력 → Dante OUT n", () => {
    let s = createSampleShow();
    s = portCol.set(s, 0, "Dante 40")!;
    s = portCol.set(s, 1, "OMNI 3")!;
    s = { ...s, outputs: s.outputs.map((b, i) => (i === 0 ? { ...b, ports: [{ kind: "dante" as const, port: 70 }] } : b)) };
    const plan = planDm7(s, parseDm7File(new Uint8Array(readFileSync(BASIC))), { ...defaultDm7Options(s), items: { ...none, patch: true, outPatch: true } });
    const after = (ch: number) => plan.changes.find((c) => c.item === "patch" && c.ch === ch && c.field === "패치")?.after;
    expect(after(1)).toBe("Dante 40");
    expect(after(2)).toBe("OMNI 3");
    expect(plan.changes.some((c) => c.item === "outPatch" && c.target === "Dante OUT 70")).toBe(true);
  });
});

import { outPortChoices, setPortAt } from "@/model/patch";
import { busesOf, updateBus } from "@/model/outputOps";
import { formatOutPorts } from "@/model/outputColumns";

describe("아웃풋 물리 출력 자유 지정 (6번)", () => {
  it("Aux 1을 두 번째 박스의 출력 5번으로 지정했다가 비운다", () => {
    const s0 = createSampleShow();
    const second = s0.stageBoxes[1];
    const pick = outPortChoices(s0, busesOf(s0, "aux")[0].id).find((c) => c.label === `${second.name} 5`)!;
    expect(pick).toBeDefined();
    const s1 = updateBus(s0, "aux", 0, { ports: setPortAt(busesOf(s0, "aux")[0].ports, 0, pick.ref) });
    expect(formatOutPorts(s1, busesOf(s1, "aux")[0].ports)).toBe(`${second.name} 5`);
    const s2 = updateBus(s1, "aux", 0, { ports: setPortAt(busesOf(s1, "aux")[0].ports, 0, null) });
    expect(busesOf(s2, "aux")[0].ports).toEqual([]);
    expect(parseShow(s2).ok).toBe(true);
  });

  it("고를 수 있는 출력: 모든 박스의 모든 출력 + OMNI OUT, 다른 버스가 쓰는 포트는 표시", () => {
    const s = createSampleShow();
    const list = outPortChoices(s);
    const total = s.stageBoxes.reduce((n, b) => n + b.outputs, 0);
    expect(list.filter((c) => c.ref.kind === "stagebox")).toHaveLength(total);
    expect(list.some((c) => c.label === "OMNI 1" && c.group.includes("OMNI"))).toBe(true);
    expect(list.find((c) => c.label === "Rio3224 1")!.users).toEqual(["Aux 1"]);
  });

  it("스테레오 L·R을 따로 바꾸기", () => {
    const L: PortRefT = { kind: "local", port: 3 };
    const R: PortRefT = { kind: "dante", port: 70 };
    const start: PortRefT[] = [{ kind: "local", port: 1 }, { kind: "local", port: 2 }];
    expect(setPortAt(start, 1, R)).toEqual([start[0], R]);
    expect(setPortAt(start, 0, L)).toEqual([L, start[1]]);
    expect(setPortAt([], 1, R)).toEqual([R]); // L이 비어 있으면 첫 자리로
  });
});
type PortRefT = import("@/model/schema").PortRef;
