import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { ensureShowMic, quantityIssues, type Library } from "@/model/library";
import { checkShow, type IssueCode, type Show } from "@/model/schema";
import { updateChannel } from "@/model/inputOps";
import { busesOf, updateBus } from "@/model/outputOps";
import { autoPatch, boxOps, boxUsage, swapPorts } from "@/model/patch";
import { parseShow } from "@/model/serialize";

const lib0 = createDefaultLibrary();
/** 화면의 오류 검사 패널과 같은 계산: Show 점검 + 보유 수량 */
const allIssues = (s: Show, lib: Library = lib0) => {
  const c = checkShow(s);
  return [...c.errors, ...c.warnings, ...quantityIssues(lib, s)];
};
const codes = (s: Show, lib?: Library) => new Set(allIssues(s, lib).map((i) => i.code));

describe("오류 검사", () => {
  it("오류가 없는 샘플 Show는 경고 0개", () => {
    expect(allIssues(createSampleShow())).toEqual([]);
  });

  it("일부러 넣은 오류 8종을 모두 잡는다", () => {
    let s = createSampleShow();
    const i = (n: number) => s.inputs.findIndex((c) => c.number === n);
    // 1. 같은 포트를 두 채널이 사용
    s = updateChannel(s, i(2), { port: s.inputs[i(1)].port });
    // 2. 박스 포트 수 초과 (Rio1608은 인풋 16개)
    s = updateChannel(s, i(23), { port: { kind: "stagebox", stageBoxId: "box-rio1608", port: 17 } });
    // 3. 리본 마이크에 48V
    const royer = lib0.microphones.find((m) => m.id === "mic-r121")!;
    const r = ensureShowMic(s, royer);
    s = updateChannel(r.show, i(14), { mic: { kind: "library", microphoneId: r.id }, phantom: true });
    // 4. 콘덴서인데 48V 꺼짐 + 액티브 DI(J48)인데 48V 꺼짐
    s = updateChannel(s, i(9), { phantom: false });
    s = updateChannel(s, i(11), { phantom: false });
    // 5. 스테레오 링크가 짝수 채널에서 시작
    s = updateChannel(s, i(12), { stereoLinkNext: true });
    // 6. 짧은 이름 글자 수 초과
    s = updateChannel(s, i(5), { shortName: "HiHatTopMic" });
    // 7. 마이크 보유 수량 초과 (SM57 1개인데 Ch 3, 4, 13에 사용)
    const lib: Library = { ...lib0, microphones: lib0.microphones.map((m) => (m.id === "mic-sm57" ? { ...m, owned: 1 } : m)) };
    // 8. 물리 출력 포트 중복
    s = updateBus(s, "aux", 1, { ports: busesOf(s, "aux")[0].ports });

    const found = codes(s, lib);
    const expected: IssueCode[] = ["dup-in-port", "port-range", "ribbon-48v", "no-48v", "link-odd", "short-name", "mic-qty", "dup-out-port"];
    for (const c of expected) expect(found.has(c), c).toBe(true);

    const msgs = allIssues(s, lib).map((x) => x.message).join("\n");
    expect(msgs).toContain("Rio3224 1: Ch 1, 2이(가) 같은 포트");
    expect(msgs).toContain("Rio1608 인풋 17: 포트 수 초과");
    expect(msgs).toContain("Royer R-121: 리본 마이크에 48V");
    expect(msgs).toContain("Neumann KM184: 콘덴서인데 48V가 꺼져");
    expect(msgs).toContain("Radial J48: 액티브 DI인데 48V가 꺼져");
    expect(msgs).toContain("Ch 12–13 링크: 홀수 채널에서 시작해야 함");
    expect(msgs).toContain("“HiHatTopMic”: 짧은 이름 8자 초과");
    expect(msgs).toContain("Shure SM57: 보유 1개인데 3개 사용");
    expect(msgs).toContain("Rio3224 1: Lead Vo Wedge, Gtr Wedge이(가) 같은 출력");
    // 모두 경고라 저장은 된다
    expect(parseShow(s).ok).toBe(true);
  });

  it("각 문제는 해당 칸을 가리킨다", () => {
    let s = createSampleShow();
    s = updateChannel(s, 4, { shortName: "WayTooLongName" });
    s = updateChannel(s, 8, { phantom: false });
    const paths = allIssues(s).map((x) => x.path);
    expect(paths).toContainEqual(["inputs", 4, "shortName"]);
    expect(paths).toContainEqual(["inputs", 8, "phantom"]);
  });
});

describe("자동 패치·포트 교체", () => {
  it("고른 채널을 빈 포트에 순서대로 (쓰는 포트는 건너뜀), 모자라면 남은 채널을 알려준다", () => {
    let s = createSampleShow();
    // 1608: 1-5 사용 중. Ch 1-3을 1608로 → 6, 7, 8
    const r = autoPatch(s, [0, 1, 2], "box-rio1608");
    expect(r.assigned).toBe(3);
    expect(r.show.inputs.slice(0, 3).map((c) => c.port)).toEqual(
      [6, 7, 8].map((port) => ({ kind: "stagebox", stageBoxId: "box-rio1608", port })),
    );
    // 시작 포트 지정 + 다시 배정하는 채널의 원래 포트는 빈 것으로 봄
    s = autoPatch(r.show, [0, 1, 2], "box-rio1608", 7).show;
    expect(s.inputs.slice(0, 3).map((c) => c.port?.kind === "stagebox" && c.port.port)).toEqual([7, 8, 9]);
    // 포트가 모자라면 남는다. 배정 못 한 채널(17-20, 23)은 1608 1-5를 그대로 쥐고 있으므로
    // 그 포트는 다른 채널에 주지 않는다 → 16 - 5 = 11채널만 배정
    const all = autoPatch(createSampleShow(), Array.from({ length: 26 }, (_, i) => i), "box-rio1608");
    expect(all.assigned).toBe(11);
    expect(all.left.length).toBe(15);
    expect(checkShow(all.show).warnings.filter((w) => w.code === "dup-in-port")).toEqual([]);
  });

  it("포트 교체: 인풋끼리 서로 바꾸기, 빈 포트로 옮기기, 아웃풋끼리", () => {
    let s = createSampleShow();
    s = swapPorts(s, { dir: "in", boxId: "box-rio3224", port: 1 }, { dir: "in", boxId: "box-rio3224", port: 2 });
    expect([s.inputs[0].port, s.inputs[1].port].map((p) => p?.kind === "stagebox" && p.port)).toEqual([2, 1]);
    s = swapPorts(s, { dir: "in", boxId: "box-rio3224", port: 2 }, { dir: "in", boxId: "box-rio1608", port: 12 });
    expect(s.inputs[0].port).toEqual({ kind: "stagebox", stageBoxId: "box-rio1608", port: 12 });
    expect(boxUsage(s, "box-rio3224").ins.has(2)).toBe(false);
    s = swapPorts(s, { dir: "out", boxId: "box-rio3224", port: 1 }, { dir: "out", boxId: "box-rio3224", port: 14 });
    expect(busesOf(s, "aux")[0].ports).toEqual([{ kind: "stagebox", stageBoxId: "box-rio3224", port: 14 }]);
    expect(allIssues(s)).toEqual([]);
  });

  it("박스를 지우면 그 박스의 패치도 비운다", () => {
    const s = boxOps.remove(createSampleShow(), 1, 1, false);
    expect(s.stageBoxes.map((b) => b.name)).toEqual(["Rio3224"]);
    expect(s.inputs.filter((c) => c.port?.kind === "stagebox" && c.port.stageBoxId === "box-rio1608")).toEqual([]);
    expect(parseShow(s).ok).toBe(true);
  });
});
