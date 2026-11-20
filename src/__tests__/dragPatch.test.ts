/** 끌어다 놓기 패치 (보완) */
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { busGroups, channelGroups, dropConflicts, dropGroups, swapUnitInto, unitsAt, unpatchUnits } from "@/model/dragPatch";
import { COLUMNS, COL_INDEX } from "@/model/inputColumns";
import { formatPort } from "@/model/labels";
import { busesOf } from "@/model/outputOps";
import { formatOutPorts } from "@/model/outputColumns";
import { OMNI_BOX } from "@/model/patch";
import { checkShow, type Show } from "@/model/schema";
import { parseShow } from "@/model/serialize";

const portCol = COLUMNS[COL_INDEX.port];
const gridPort = (s: Show, i: number) => portCol.text(s, s.inputs[i]);
/** 샘플에서 패치를 모두 지운 Show */
const unpatched = (): Show => {
  const s = createSampleShow();
  return { ...s, inputs: s.inputs.map((c) => ({ ...c, port: null })) };
};

describe("인풋 채널 끌어다 놓기", () => {
  it("패치 안 된 채널 8개를 골라 Rio 1번에 놓으면 1~8번에 순서대로 (인풋 그리드에 그대로)", () => {
    const s0 = unpatched();
    const rio = s0.stageBoxes[0];
    // 링크 없는 채널 8개 (번호가 뒤섞인 선택 순서여도 채널 번호 순)
    const ids = s0.inputs.filter((c) => !c.stereoLinkNext && !s0.inputs.find((p) => p.number === c.number - 1)?.stereoLinkNext).slice(0, 8).map((c) => c.id).reverse();
    const groups = channelGroups(s0, ids);
    expect(dropConflicts(s0, "in", groups, rio.id, 1)).toEqual([]);
    const { show: s, plan } = dropGroups(s0, "in", groups, rio.id, 1, "overwrite");
    expect(plan.left).toBe(0);
    const placed = s.inputs.filter((c) => ids.includes(c.id)).sort((a, b) => a.number - b.number);
    expect(placed.map((c) => formatPort(c.port, s.stageBoxes))).toEqual(Array.from({ length: 8 }, (_, i) => `${rio.name} ${i + 1}`));
    expect(s.inputs.indexOf(placed[0]) >= 0 && gridPort(s, s.inputs.indexOf(placed[0]))).toBe(`${rio.name} 1`);
    expect(parseShow(s).ok).toBe(true);
  });

  it("5번 포트의 채널을 다른 박스의 3번 포트로 옮긴다", () => {
    const s0 = createSampleShow();
    const [a, b] = s0.stageBoxes;
    const [u] = unitsAt(s0, "in", a.id, 5);
    expect(u).toBeDefined();
    const s = dropGroups(s0, "in", channelGroups(s0, [(u as { channelId: string }).channelId]), b.id, 3, "overwrite").show;
    const ch = s.inputs.find((c) => c.id === (u as { channelId: string }).channelId)!;
    expect(formatPort(ch.port, s.stageBoxes)).toBe(`${b.name} 3`);
  });

  it("다른 채널이 있는 포트: 교체(있던 것은 해제) / 서로 바꾸기(있던 것은 원래 포트로)", () => {
    const s0 = createSampleShow();
    const rio = s0.stageBoxes[0];
    const ch1 = s0.inputs[0]; // Rio 1
    const ch2 = s0.inputs[1]; // Rio 2
    const g = channelGroups(s0, [ch1.id]);
    expect(dropConflicts(s0, "in", g, rio.id, 2).map((d) => d.unit)).toEqual([{ dir: "in", channelId: ch2.id }]);
    const replaced = dropGroups(s0, "in", g, rio.id, 2, "overwrite").show;
    expect(replaced.inputs[0].port).toEqual({ kind: "stagebox", stageBoxId: rio.id, port: 2 });
    expect(replaced.inputs[1].port).toBeNull();
    const swapped = swapUnitInto(s0, "in", { dir: "in", channelId: ch1.id }, rio.id, 2);
    expect(swapped.inputs[0].port).toEqual({ kind: "stagebox", stageBoxId: rio.id, port: 2 });
    expect(swapped.inputs[1].port).toEqual({ kind: "stagebox", stageBoxId: rio.id, port: 1 });
  });

  it("여러 채널을 놓는데 중간에 쓰는 포트가 있으면: 건너뛰기 / 덮어쓰기", () => {
    let s0 = unpatched();
    const rio = s0.stageBoxes[0];
    const other = s0.inputs[20];
    s0 = { ...s0, inputs: s0.inputs.map((c) => (c.id === other.id ? { ...c, port: { kind: "stagebox", stageBoxId: rio.id, port: 3 } } : c)) };
    const ids = [s0.inputs[0].id, s0.inputs[1].id, s0.inputs[2].id, s0.inputs[3].id];
    const groups = channelGroups(s0, ids);
    expect(dropConflicts(s0, "in", groups, rio.id, 1).length).toBe(1);
    const skip = dropGroups(s0, "in", groups, rio.id, 1, "skip").show;
    expect(ids.map((id) => skip.inputs.find((c) => c.id === id)!.port).map((p) => (p as { port: number }).port)).toEqual([1, 2, 4, 5]);
    expect(skip.inputs.find((c) => c.id === other.id)!.port).toMatchObject({ port: 3 });
    const over = dropGroups(s0, "in", groups, rio.id, 1, "overwrite").show;
    expect(ids.map((id) => (over.inputs.find((c) => c.id === id)!.port as { port: number }).port)).toEqual([1, 2, 3, 4]);
    expect(over.inputs.find((c) => c.id === other.id)!.port).toBeNull();
    expect(checkShow(over).warnings.filter((w) => w.code === "dup-in-port")).toEqual([]);
  });

  it("스테레오 링크 채널은 짝과 함께 연속한 두 포트에 (건너뛸 때도 붙여서)", () => {
    let s0 = unpatched();
    const rio = s0.stageBoxes[0];
    const L = s0.inputs.find((c) => c.stereoLinkNext)!;
    const R = s0.inputs.find((c) => c.number === L.number + 1)!;
    // R만 골라도 L이 함께
    const groups = channelGroups(s0, [R.id]);
    expect(groups).toEqual([[{ dir: "in", channelId: L.id }, { dir: "in", channelId: R.id }]]);
    // 2번이 사용 중이면 건너뛰어 3·4번에
    const busy = s0.inputs[0];
    s0 = { ...s0, inputs: s0.inputs.map((c) => (c.id === busy.id ? { ...c, port: { kind: "stagebox", stageBoxId: rio.id, port: 2 } } : c)) };
    const s = dropGroups(s0, "in", groups, rio.id, 1, "skip").show;
    expect([L, R].map((c) => (s.inputs.find((x) => x.id === c.id)!.port as { port: number }).port)).toEqual([3, 4]);
  });

  it("포트가 모자라면 들어가는 만큼만, 나머지 수를 알려 준다", () => {
    const s0 = unpatched();
    const box = s0.stageBoxes[1]; // 16 인풋
    const ids = s0.inputs.map((c) => c.id);
    const { plan } = dropGroups(s0, "in", channelGroups(s0, ids), box.id, 10, "overwrite");
    expect(plan.placements.length).toBeLessThanOrEqual(7);
    expect(plan.left).toBe(s0.inputs.length - plan.placements.length);
  });

  it("현황판 밖으로 끌어내면 패치 해제 (한 번의 변경 → 실행 취소 한 번)", () => {
    const s0 = createSampleShow();
    const units = unitsAt(s0, "in", s0.stageBoxes[0].id, 5);
    const s = unpatchUnits(s0, units);
    expect(s.inputs.find((c) => c.id === (units[0] as { channelId: string }).channelId)!.port).toBeNull();
    expect(s0.inputs.find((c) => c.id === (units[0] as { channelId: string }).channelId)!.port).not.toBeNull(); // 이전 상태(실행 취소 대상)는 그대로
  });

  it("박스 없는 포트(OMNI)에도 놓을 수 있다", () => {
    const s0 = unpatched();
    const s = dropGroups(s0, "in", channelGroups(s0, [s0.inputs[0].id]), OMNI_BOX, 7, "overwrite").show;
    expect(gridPort(s, 0)).toBe("OMNI 7");
  });
});

describe("아웃풋 버스 끌어다 놓기", () => {
  it("스테레오 버스는 L·R이 연속한 두 포트에, 한쪽만 따로 옮길 수도", () => {
    const s0 = createSampleShow();
    const box = s0.stageBoxes[1];
    const st = busesOf(s0, "aux").find((b) => b.width === "stereo")!;
    let s = dropGroups(s0, "out", busGroups(s0, [st.id]), box.id, 3, "overwrite").show;
    expect(formatOutPorts(s, s.outputs.find((b) => b.id === st.id)!.ports)).toBe(`${box.name} 3-4`);
    s = dropGroups(s, "out", busGroups(s, [st.id], 1), box.id, 8, "overwrite").show;
    expect(formatOutPorts(s, s.outputs.find((b) => b.id === st.id)!.ports)).toBe(`${box.name} 3, 8`);
    expect(parseShow(s).ok).toBe(true);
  });

  it("다른 버스가 있는 출력 포트에 교체로 놓으면 그 버스의 출력이 비워진다", () => {
    const s0 = createSampleShow();
    const [aux1, aux2] = busesOf(s0, "aux");
    const p = aux2.ports[0] as { stageBoxId: string; port: number };
    const s = dropGroups(s0, "out", busGroups(s0, [aux1.id]), p.stageBoxId, p.port, "overwrite").show;
    expect(s.outputs.find((b) => b.id === aux1.id)!.ports).toEqual([aux2.ports[0]]);
    expect(s.outputs.find((b) => b.id === aux2.id)!.ports).toEqual([]);
  });
});
