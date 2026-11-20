import { describe, expect, it } from "vitest";
import { createEmptyShow } from "@/model/factory";
import { createSampleShow } from "@/sample/fivePieceBand";
import {
  busAccess,
  busesOf,
  formatRanges,
  groupAccess,
  groupMembers,
  parseRanges,
  rowOps,
} from "@/model/outputOps";
import { busColumns, formatOutPorts, groupColumns, parseBusRefs, parseOutPorts } from "@/model/outputColumns";
import { applyPreset, BUS_PRESETS, suggestNextPresets } from "@/model/busPresets";
import { sheetPaste } from "@/model/sheet";
import { COLUMNS, COL_INDEX } from "@/model/inputColumns";
import { parseShow } from "@/model/serialize";
import type { BusKind, Show } from "@/model/schema";

const ok = (s: Show) => {
  const r = parseShow(s);
  return r.ok ? [] : r.errors;
};
const preset = (kind: BusKind, id: string) => BUS_PRESETS[kind].find((p) => p.id === id)!;

/** 표 끝(새 행)에 프리셋을 고르는 한 번의 누르기 */
function press(show: Show, kind: BusKind, id: string): Show {
  const ops = rowOps(busAccess(kind));
  const row = ops.count(show);
  return applyPreset(ops.append(show), kind, row, preset(kind, id));
}

describe("출력 포트 해석", () => {
  const show = createSampleShow();
  const [rio32, rio16] = show.stageBoxes.map((b) => b.id);
  it("범위, 쉼표, 박스-포트, 로컬, 번호만", () => {
    expect(parseOutPorts(show, "aux", 0, "Rio3224 5-6")).toEqual([
      { kind: "stagebox", stageBoxId: rio32, port: 5 },
      { kind: "stagebox", stageBoxId: rio32, port: 6 },
    ]);
    expect(parseOutPorts(show, "aux", 0, "1608 3, 5").map((p) => p.kind === "stagebox" && [p.stageBoxId, p.port])).toEqual([
      [rio16, 3],
      [rio16, 5],
    ]);
    expect(parseOutPorts(show, "aux", 0, "1608-3")).toEqual([{ kind: "stagebox", stageBoxId: rio16, port: 3 }]);
    expect(parseOutPorts(show, "aux", 0, "L1-2")).toEqual([{ kind: "local", port: 1 }, { kind: "local", port: 2 }]);
    // 번호만: 윗 버스(Aux 4 = Rio1608 1)와 같은 박스
    expect(parseOutPorts(show, "aux", 4, "7")).toEqual([{ kind: "stagebox", stageBoxId: rio16, port: 7 }]);
    expect(parseOutPorts(show, "aux", 0, "")).toEqual([]);
  });
  it("표시 ↔ 해석 왕복", () => {
    for (const text of ["Rio3224 5-6", "Rio3224 5, 7", "OMNI 1-2", "Rio1608 1, Rio3224 2", "Dante 9-10", "Rio1608 3, OMNI 4"])
      expect(formatOutPorts(show, parseOutPorts(show, "matrix", 0, text))).toBe(text);
    // 예전 표기 "Local"도 읽는다
    expect(formatOutPorts(show, parseOutPorts(show, "matrix", 0, "Local 1-2"))).toBe("OMNI 1-2");
  });
  it("Matrix 소스: Main L/R, Aux 번호", () => {
    expect(parseBusRefs(show, "Main L/R, Aux 5")).toEqual(["bus-main-1", "bus-aux-5"]);
    expect(parseBusRefs(show, "main")).toEqual(["bus-main-1"]);
    expect(parseBusRefs(show, "Aux 99")).toBeNull();
  });
});

describe("누르기 입력 (버스 이름)", () => {
  it("샘플 Show에 모니터 6, IEM 스테레오 2, FX 4, Matrix 4", () => {
    let s = createSampleShow();
    s = { ...s, outputs: busesOf(s, "main") }; // 메인만 남기고 새로 입력
    for (let i = 0; i < 6; i++) s = press(s, "aux", "wedge");
    for (let i = 0; i < 2; i++) s = press(s, "aux", "iem");
    for (const id of ["reverb", "reverb", "delay", "plate"]) s = press(s, "aux", id);
    for (const id of ["front-fill", "delay-spk", "lobby", "mtx-rec"]) s = press(s, "matrix", id);

    const aux = busesOf(s, "aux");
    expect(aux.map((b) => b.name)).toEqual([
      "Wedge 1", "Wedge 2", "Wedge 3", "Wedge 4", "Wedge 5", "Wedge 6",
      "IEM 1", "IEM 2", "Reverb 1", "Reverb 2", "Delay 1", "Plate",
    ]);
    expect(aux.map((b) => b.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(aux.slice(0, 6).every((b) => b.purpose === "wedge" && b.width === "mono" && b.tap === "pre")).toBe(true);
    expect(aux.slice(6, 8).every((b) => b.purpose === "iem" && b.width === "stereo" && b.tap === "pre")).toBe(true);
    expect(aux.slice(8).every((b) => b.purpose === "fx" && b.tap === "post")).toBe(true);

    const mtx = busesOf(s, "matrix");
    expect(mtx.map((b) => [b.name, b.purpose, b.width])).toEqual([
      ["Front Fill", "frontfill", "mono"],
      ["Delay Spk", "delay", "stereo"],
      ["Lobby", "lobby", "mono"],
      ["Rec", "record", "stereo"],
    ]);
    // 소스가 비어 있으면 Main L/R에서 받음
    expect(mtx.every((b) => b.sources[0] === "bus-main-1")).toBe(true);
    expect(ok(s)).toEqual([]);
  });

  it("다음 추천: 번호 프리셋은 반복, 아니면 목록 다음", () => {
    let s = createEmptyShow();
    s = press(s, "aux", "wedge");
    expect(suggestNextPresets(s, "aux", 1)[0].id).toBe("wedge");
    s = press(s, "matrix", "front-fill");
    expect(suggestNextPresets(s, "matrix", 1)[0].id).toBe("delay-spk");
  });

  it("같은 번호 프리셋을 다시 고르면 번호 유지, 포트·비고는 그대로", () => {
    let s = press(press(createEmptyShow(), "aux", "wedge"), "aux", "wedge");
    s = busColumns("aux")[5].set(s, 1, "Rio3224 2")!; // 물리 출력
    s = applyPreset(s, "aux", 1, preset("aux", "wedge"));
    expect(busesOf(s, "aux")[1].name).toBe("Wedge 2");
    expect(busesOf(s, "aux")[1].ports.length).toBe(1);
  });
});

describe("표 붙여넣기·행 조작", () => {
  it("엑셀 헤더로 Aux 표 붙여넣기", () => {
    const text = ["MIX\tNAME\tTYPE\tST\tPRE/POST\tOUTPUT", "1\tVox Wdg\tmon\tm\tpre\tRio3224 1", "2\tDrum IEM\tiem\tst\tpre\tRio3224 3-4"].join("\n");
    const res = sheetPaste(createSampleShow(), busColumns("aux"), rowOps(busAccess("aux")), 0, 0, text);
    const aux = busesOf(res.show, "aux");
    expect(res.skipped).toEqual([]);
    expect(aux[1]).toMatchObject({ number: 2, name: "Drum IEM", purpose: "iem", width: "stereo", tap: "pre" });
    expect(aux[1].ports.length).toBe(2);
  });

  it("버스를 지우면 Matrix 소스에서도 빠지고, 깨진 참조는 오류", () => {
    let s = createSampleShow();
    s = busColumns("matrix")[4].set(s, 0, "Main L/R, Aux 7")!; // Front Fill ← Main + Side Fill
    expect(busesOf(s, "matrix")[0].sources).toEqual(["bus-main-1", "bus-aux-7"]);
    s = rowOps(busAccess("aux")).remove(s, 6, 6, true);
    expect(busesOf(s, "matrix")[0].sources).toEqual(["bus-main-1"]);
    expect(ok(s)).toEqual([]);
    const broken = { ...s, outputs: s.outputs.map((b) => (b.kind === "matrix" ? { ...b, sources: ["nope"] } : b)) };
    expect(ok(broken).join()).toContain("없는 버스");
  });
});

describe("DCA·뮤트 그룹 ↔ 인풋 그리드", () => {
  it("범위 표기", () => {
    expect(formatRanges([1, 2, 3, 4, 7, 9, 10])).toBe("1-4, 7, 9, 10");
    expect([...parseRanges("1-4, 7 ch9")!]).toEqual([1, 2, 3, 4, 7, 9]);
    expect(parseRanges("드럼")).toBeNull();
  });

  it("DCA 화면에서 멤버를 바꾸면 인풋의 DCA 열이 바뀐다 (양방향)", () => {
    let s = createSampleShow();
    const dcaCol = COLUMNS[COL_INDEX.dca];
    const members = groupColumns("dca")[2];
    expect(members.text(s, s.dcas[0])).toBe("1-10"); // Drums
    s = members.set(s, 0, "1-4, 21")!;
    expect(dcaCol.text(s, s.inputs[20])).toBe("5, 1"); // 21번 Lead Vocal: Vox(5) + Drums(1)
    expect(dcaCol.text(s, s.inputs[5])).toBe(""); // 6번은 Drums에서 빠짐
    // 반대로 인풋 그리드에서 DCA를 넣으면 DCA 화면 멤버에 나타난다
    s = dcaCol.set(s, 5, "1")!;
    expect(groupMembers(s, "dca", "dca-1")).toEqual([1, 2, 3, 4, 6, 21]);
    expect(ok(s)).toEqual([]);
  });

  it("DCA를 지우면 채널에서도 빠진다", () => {
    let s = createSampleShow();
    s = rowOps(groupAccess("dca")).remove(s, 0, 0, false);
    expect(s.inputs.some((c) => c.dcaIds.includes("dca-1"))).toBe(false);
    expect(ok(s)).toEqual([]);
    s = rowOps(groupAccess("mute")).remove(s, 0, 0, true);
    expect(s.muteGroups.map((g) => g.number)).toEqual([1, 2]);
    expect(ok(s)).toEqual([]);
  });

  it("새 Show에는 Main L/R, Mono/Sub가 있다", () => {
    const mains = busesOf(createEmptyShow(), "main");
    expect(mains.map((b) => [b.name, b.width])).toEqual([["Main L/R", "stereo"], ["Mono/Sub", "mono"]]);
  });
});
