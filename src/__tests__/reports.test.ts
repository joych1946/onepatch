import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import {
  channelLabels,
  equipmentSummary,
  INPUT_REPORT_COLUMNS,
  inputReportRows,
  outputReportSections,
  patchSheet,
  toCsv,
} from "@/model/reports";
import { buildShowXlsx } from "@/lib/showExport";
import { buildXlsx } from "@/lib/xlsx";

const sample = createSampleShow();

describe("출력물 데이터", () => {
  it("인풋리스트: 모든 채널, 48V·패치·컬러·DCA", () => {
    const rows = inputReportRows(sample);
    expect(rows.length).toBe(26);
    expect(rows[0].cells).toMatchObject({ ch: 1, source: "Kick In", mic: "Shure Beta 91A", phantom: "48V", port: "Rio3224 1", color: "빨강", dca: "1 Drums" });
    expect(rows[8].cells.link).toBe("↔10");
    expect(rows[12].cells.stand).toBe("없음"); // 스탠드 없음으로 지정한 채널
  });

  it("아웃풋: Aux·Matrix·Main 구역과 물리 출력", () => {
    const secs = outputReportSections(sample);
    expect(secs.map((s) => [s.title, s.rows.length])).toEqual([["Aux / Mix", 9], ["Matrix", 3], ["Main", 1]]);
    expect(secs[0].rows[4].cells).toMatchObject({ bus: "Aux 5", name: "Drum IEM", width: "St", tap: "Pre", ports: "Rio3224 5-6" });
    expect(secs[1].rows[0].cells.sources).toBe("Main LR");
  });

  it("패치 시트: 박스의 모든 포트(빈 포트 포함)", () => {
    const { ins, outs } = patchSheet(sample, "box-rio3224");
    expect(ins.length).toBe(32);
    expect(outs.length).toBe(16);
    expect(ins[0]).toMatchObject({ port: 1, main: "1", name: "Kick In" });
    expect(ins[0].detail).toContain("48V");
    expect(ins[31]).toMatchObject({ port: 32, main: "" });
    expect(outs[4]).toMatchObject({ main: "Aux 5 L", name: "Drum IEM" });
  });

  it("장비 집계: 모델·스탠드·DI·케이블", () => {
    const lib = createDefaultLibrary();
    const owned = { ...lib, microphones: lib.microphones.map((m) => (m.id === "mic-sm57" ? { ...m, owned: 2 } : m)) };
    const eq = equipmentSummary(sample, owned, 10);
    const sm57 = eq.mics.find((m) => m.model === "Shure SM57")!;
    expect([sm57.count, sm57.owned, sm57.channels]).toEqual([3, 2, [3, 4, 13]]);
    expect(eq.mics.reduce((n, m) => n + m.count, 0)).toBe(26);
    expect(eq.stands.find((s) => s.stand === "숏T")?.count).toBeGreaterThan(0);
    expect(eq.di).toEqual({ active: 2, passive: 4, unknown: 0, total: 6 }); // J48 2, ProD2 4
    const cable = Object.fromEntries(eq.cables.map((c) => [c.kind, [c.count, c.withSpare]]));
    expect(cable["XLR (무선 수신기 → 박스)"]).toEqual([2, 3]);
    expect(cable["악기 케이블 TS (악기 → DI)"]).toEqual([6, 7]);
    expect(cable["XLR (마이크·DI → 박스)"]).toEqual([24, 27]); // 26 - 무선 2
    expect(cable["XLR (박스 → 스피커·앰프·IEM)"]![0]).toBe(17); // Aux 10 + Matrix 5 + Main 2
  });

  it("라벨: 채널마다 번호·이름·패치·컬러", () => {
    const l = channelLabels(sample);
    expect(l.length).toBe(26);
    expect(l[0]).toMatchObject({ ch: 1, name: "Kick In", port: "Rio3224 1", color: "red" });
  });

  it("CSV: BOM, 쉼표·따옴표 처리", () => {
    const csv = toCsv(INPUT_REPORT_COLUMNS.slice(0, 2), [{ cells: { ch: 1, source: 'Kick, "In"' } }]);
    expect(csv.startsWith("﻿Ch,소스\r\n")).toBe(true);
    expect(csv).toContain('1,"Kick, ""In"""');
  });
});

describe("엑셀(xlsx)", () => {
  it("시트 구성과 셀 값", () => {
    const zip = unzipSync(buildShowXlsx(sample, createDefaultLibrary()));
    const wb = strFromU8(zip["xl/workbook.xml"]);
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["인풋리스트", "아웃풋", "패치 Rio3224", "패치 Rio1608", "장비 집계"]);
    const s1 = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    expect(s1).toContain("Kick In");
    expect(s1).toContain("Shure Beta 91A");
    expect(s1).toMatch(/<pane ySplit="4"/); // 제목 2줄 + 빈 줄 + 머리글
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(["[Content_Types].xml", "_rels/.rels", "xl/styles.xml", "xl/_rels/workbook.xml.rels"]));
  });

  it("XML 특수문자·숫자 셀·시트 이름 정리", () => {
    const zip = unzipSync(buildXlsx([{ name: "a/b:c", columns: [{ label: "x" }, { label: "y" }], rows: [["<&>", 3]] }]));
    const s = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    expect(s).toContain("&lt;&amp;&gt;");
    expect(s).toContain("<v>3</v>");
    expect(strFromU8(zip["xl/workbook.xml"])).toContain('name="a b c"');
  });
});
