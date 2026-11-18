import { describe, expect, it } from "vitest";
import { createEmptyShow } from "@/model/factory";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { applyPaste, parseTsv, toTsv } from "@/model/inputPaste";
import { COLUMNS, COL_INDEX, parseBool, parseColor, parseMic, parsePort } from "@/model/inputColumns";
import { deleteRange, duplicateRange, insertAfter, moveRange } from "@/model/inputOps";
import { micName, resolvePhantom, resolveStand } from "@/model/derive";
import { parseShow } from "@/model/serialize";

const valid = (s: Parameters<typeof parseShow>[0]) => {
  const r = parseShow(s);
  return r.ok ? [] : r.errors;
};

describe("TSV", () => {
  it("엑셀 따옴표·CRLF를 처리한다", () => {
    expect(parseTsv('a\t"b\nc"\td\r\n1\t2\t3\r\n')).toEqual([
      ["a", "b\nc", "d"],
      ["1", "2", "3"],
    ]);
  });
  it("toTsv → parseTsv 왕복", () => {
    const rows = [["Kick", 'say "hi"', "a\tb"], ["", "x", ""]];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
});

describe("값 해석", () => {
  const show = createSampleShow();
  it("마이크: 정확한 이름, 제조사 생략, 라이브러리에 없는 장비", () => {
    expect(parseMic(show, "shure sm58")).toEqual({ kind: "library", microphoneId: "mic-sm58" });
    expect(parseMic(show, "SM58")).toEqual({ kind: "library", microphoneId: "mic-sm58" });
    expect(parseMic(show, "Beta91A")).toEqual({ kind: "library", microphoneId: "mic-beta91a" });
    expect(parseMic(show, "AKG C414")).toEqual({ kind: "custom", name: "AKG C414" });
    expect(parseMic(show, "")).toBeNull();
  });
  it("포트: 번호만, 박스 이름, 로컬, 기타", () => {
    // 2번 행(index 1) 위는 Rio3224
    expect(parsePort(show, 1, "7")).toEqual({ kind: "stagebox", stageBoxId: "box-rio3224", port: 7 });
    expect(parsePort(show, 1, "Rio1608 3")).toEqual({ kind: "stagebox", stageBoxId: "box-rio1608", port: 3 });
    expect(parsePort(show, 1, "1608-3")).toEqual({ kind: "stagebox", stageBoxId: "box-rio1608", port: 3 });
    expect(parsePort(show, 1, "L2")).toEqual({ kind: "local", port: 2 });
    expect(parsePort(show, 1, "Dante 무선 RX")).toEqual({ kind: "other", label: "Dante 무선 RX" });
  });
  it("48V/컬러 표기", () => {
    expect(["48V", "+48V", "O", "y", "✓", "on"].map(parseBool)).toEqual(Array(6).fill(true));
    expect(["X", "-", "off", "0"].map(parseBool)).toEqual(Array(4).fill(false));
    expect(parseBool("")).toBeNull();
    expect(parseColor("빨강")).toBe("red");
    expect(parseColor("Blue")).toBe("blue");
    expect(parseColor("형광")).toBeUndefined();
  });
});

describe("엑셀 붙여넣기", () => {
  // 실제 현장 인풋리스트처럼 열 순서·이름이 우리와 다른 표
  const excel = [
    "CH\tINST\tMIC/DI\tSTAND\t+48V\tPATCH\tNOTE\tMON",
    "1\tKick In\tBeta 91A\t\tO\t1\t\tx",
    "2\tKick Out\tBeta 52A\t숏붐\t\t2\t\tx",
    "3\tSnare\tSM57\t\t\t3\t위상 확인\t",
    "",
    "4\tOH L\tKM184\t톨붐\tO\tRio1608 1\t\t",
    "5\tVocal\tAKG C7\t톨붐\t\tL1\t무선\t",
  ].join("\r\n");

  it("헤더를 인식해 열을 맞추고, 모르는 열은 무시하고, 빈 줄은 건너뛴다", () => {
    // 새 Show는 마이크가 비어 있고, 이름은 내 라이브러리에서 찾아 Show로 복사된다
    const res = applyPaste(createEmptyShow(), 0, 0, excel, { catalog: createDefaultLibrary().microphones });
    const s = res.show;
    expect(res.rowCount).toBe(5);
    expect(res.headerMap?.find((h) => h.from === "MON")?.to).toBeNull();
    expect(res.skipped).toEqual([]);
    expect(s.inputs.map((c) => c.number)).toEqual([1, 2, 3, 4, 5]);
    expect(s.inputs.map((c) => c.source)).toEqual(["Kick In", "Kick Out", "Snare", "OH L", "Vocal"]);
    expect(s.inputs.map((c) => micName(s, c))).toEqual([
      "Shure Beta 91A", "Shure Beta 52A", "Shure SM57", "Neumann KM 184", "AKG C7",
    ]);
    expect(resolvePhantom(s, s.inputs[0])).toBe(true);
    expect(resolveStand(s, s.inputs[2])).toBe("숏붐"); // 빈 칸 → SM57 기본값
    expect(s.inputs[3].port).toEqual({ kind: "stagebox", stageBoxId: s.stageBoxes[1].id, port: 1 });
    expect(s.inputs[4].port).toEqual({ kind: "local", port: 1 });
    expect(s.inputs[2].notes).toBe("위상 확인");
    expect(valid(s)).toEqual([]);
  });

  it("헤더가 없으면 활성 셀 위치부터 우리 열 순서대로 들어간다", () => {
    const show = createSampleShow();
    const res = applyPaste(show, 2, COL_INDEX.source, "Snare Top\tSN\nSnare Bot\tSN B");
    expect(res.show.inputs[2].source).toBe("Snare Top");
    expect(res.show.inputs[3].shortName).toBe("SN B");
    expect(res.show.inputs[3].mic).toEqual(show.inputs[3].mic); // 범위 밖 열은 그대로
  });

  it("끝을 넘으면 채널이 추가되고, 인식 못 한 값은 보고한다", () => {
    const show = createSampleShow();
    const res = applyPaste(show, 24, COL_INDEX.source, "A\nB\tB\t\t\t\t\t\t형광");
    expect(res.show.inputs.length).toBe(26);
    expect(res.skipped.length).toBe(1);
  });

  it("복사(표시 텍스트)한 것을 다시 붙여넣으면 같은 데이터가 된다", () => {
    const show = createSampleShow();
    const text = toTsv(show.inputs.map((ch) => COLUMNS.map((c) => c.text(show, ch))));
    const header = COLUMNS.map((c) => c.label).join("\t");
    const res = applyPaste({ ...show, inputs: [] }, 0, 0, header + "\n" + text);
    const strip = (s: typeof show) =>
      s.inputs.map((c) => ({ ...c, stand: resolveStand(s, c), phantom: resolvePhantom(s, c) }));
    expect(strip(res.show).map((c) => [c.number, c.source, c.shortName, c.mic, c.stand, c.phantom, c.port, c.stereoLinkNext, c.color, c.dcaIds]))
      .toEqual(strip(show).map((c) => [c.number, c.source, c.shortName, c.mic, c.stand, c.phantom, c.port, c.stereoLinkNext, c.color, c.dcaIds]));
  });
});

describe("행 조작", () => {
  const nums = (s: ReturnType<typeof createSampleShow>) => s.inputs.map((c) => c.number);

  it("자동 번호 켜짐: 삽입·삭제·이동 후 1..n", () => {
    let s = createSampleShow();
    s = insertAfter(s, 2, true);
    expect(nums(s)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    s = deleteRange(s, 0, 1, true);
    expect(nums(s)[0]).toBe(1);
    const src = s.inputs[5].source;
    s = moveRange(s, 5, 5, 0, true).show;
    expect(s.inputs[0].source).toBe(src);
    expect(s.inputs[0].number).toBe(1);
  });

  it("자동 번호 꺼짐: 번호가 행을 따라간다", () => {
    let s = createSampleShow();
    const { show: moved, start } = moveRange(s, 0, 1, 5, false);
    expect(start).toBe(3);
    expect(moved.inputs[3].number).toBe(1);
    s = duplicateRange(s, 0, 0, false);
    expect(s.inputs[1].source).toBe("Kick In");
    expect(s.inputs[1].number).toBe(27);
    expect(s.inputs[1].id).not.toBe(s.inputs[0].id);
    expect(valid(s)).toEqual([]);
  });
});
