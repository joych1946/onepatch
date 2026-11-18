import { describe, expect, it } from "vitest";
import { createEmptyShow } from "@/model/factory";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { LibrarySchema, quantityIssues, type Library } from "@/model/library";
import {
  BUILTIN_BLOCKS,
  BUILTIN_SHOW_TEMPLATES,
  insertBlock,
  makeBlockTemplate,
  makeShowTemplate,
  resolveBuiltin,
  showFromTemplate,
  toTemplateChannels,
} from "@/model/templates";
import { checkShow, type Show } from "@/model/schema";
import { micName, resolvePhantom } from "@/model/derive";
import { busesOf } from "@/model/outputOps";
import { parseShow } from "@/model/serialize";

const lib0 = createDefaultLibrary();
const block = (id: string) => BUILTIN_BLOCKS.find((b) => b.id === id)!;
const warnings = (s: Show, lib: Library = lib0) => [...checkShow(s).warnings, ...quantityIssues(lib, s)];
const port = (s: Show, i: number) => {
  const p = s.inputs[i].port;
  return p?.kind === "stagebox" ? `${s.stageBoxes.find((b) => b.id === p.stageBoxId)!.name} ${p.port}` : String(p);
};

/** 맨 끝에 블록 하나 넣기 */
const add = (s: Show, id: string, lib = lib0) => insertBlock(s, lib, resolveBuiltin(block(id), lib, s), s.inputs.length, true).show;

describe("기본 블록 템플릿", () => {
  it("8종의 채널 수", () => {
    const s = createEmptyShow();
    const counts = Object.fromEntries(BUILTIN_BLOCKS.map((b) => [b.name, resolveBuiltin(b, lib0, s).length]));
    expect(counts).toEqual({
      "드럼 8ch": 8, "드럼 12ch": 12, "베이스 DI+Mic": 2, "키보드 스테레오": 2,
      "보컬 4": 4, "합창 오버헤드": 2, "MR 스테레오": 2, "사회자": 2,
    });
  });

  it("빈 Show에 블록 6개 → 24채널, 번호·패치가 이어지고 경고 0개", () => {
    let s = createEmptyShow();
    for (const id of ["drums-12", "bass", "keys", "vox-4", "mr", "mc"]) s = add(s, id);
    expect(s.inputs.length).toBe(24);
    expect(s.inputs.map((c) => c.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(s.inputs.map((_, i) => port(s, i))).toEqual(Array.from({ length: 24 }, (_, i) => `Rio3224 ${i + 1}`));
    expect(s.inputs.map((c) => c.source).slice(10, 16)).toEqual(["OH L", "OH R", "Bass DI", "Bass Mic", "Keys L", "Keys R"]);
    expect(micName(s, s.inputs[0])).toBe("Shure Beta 91A");
    expect(resolvePhantom(s, s.inputs[0])).toBe(true);
    expect(s.inputs[10].stereoLinkNext).toBe(true);
    expect(s.dcas.map((d) => `${d.number} ${d.name}`)).toEqual(["1 Drums", "2 Bass", "3 Keys", "4 Vox", "5 MR", "6 MC"]);
    expect(s.inputs[0].dcaIds).toEqual([s.dcas[0].id]);
    expect(warnings(s)).toEqual([]);
    expect(parseShow(s).ok).toBe(true);
  });

  it("보유한 마이크가 있으면 그것을 먼저", () => {
    const lib: Library = { ...lib0, microphones: lib0.microphones.map((m) => (m.id === "mic-e902" ? { ...m, owned: 2 } : m)) };
    const s = add(createEmptyShow(), "drums-12", lib);
    expect(micName(s, s.inputs[1])).toBe("Sennheiser e902"); // Kick Out
  });

  it("중간에 끼워 넣으면 아래가 밀리고, 패치는 위 채널에 이어서 빈 포트로", () => {
    let s = createSampleShow(); // 1608 1-5 사용 중
    // Keys Vocal(23, 1608 5) 다음 = 24번 자리에 MR 스테레오
    const r = insertBlock(s, lib0, resolveBuiltin(block("mr"), lib0, s), 23, true);
    s = r.show;
    expect([r.from, r.to]).toEqual([23, 24]);
    expect(s.inputs.slice(22, 26).map((c) => `${c.number} ${c.source}`)).toEqual(["23 Keys Vocal", "24 MR L", "25 MR R", "26 Bass Chorus"]);
    expect([port(s, 23), port(s, 24)]).toEqual(["Rio1608 6", "Rio1608 7"]);
    // 번호 다시 매기기 꺼짐: 위 번호 다음의 빈 번호
    const off = insertBlock(createSampleShow(), lib0, resolveBuiltin(block("mc"), lib0, createSampleShow()), 26, false).show;
    expect(off.inputs.slice(-2).map((c) => c.number)).toEqual([27, 28]);
    expect(warnings(s).filter((w) => w.code !== "link-odd")).toEqual([]);
  });

  it("박스가 차면 다음 박스로, 모두 차면 패치 없이", () => {
    let s = createEmptyShow();
    for (let i = 0; i < 4; i++) s = add(s, "drums-12"); // 48ch: Rio3224 32 + Rio1608 16
    expect(port(s, 31)).toBe("Rio3224 32");
    expect(port(s, 32)).toBe("Rio1608 1");
    s = add(s, "mc");
    expect(s.inputs.slice(-2).map((c) => c.port)).toEqual([null, null]);
  });
});

describe("내 템플릿", () => {
  it("선택한 채널 → 블록 템플릿 → 다른 Show에 그대로 (마이크·DCA·뮤트·48V 포함)", () => {
    const src = createSampleShow();
    const t = makeBlockTemplate("키보드 세트", toTemplateChannels(src, [16, 17, 18, 19, 22])); // Keys L/R, Synth L/R, Keys Vocal
    expect(t.channels.map((c) => c.source)).toEqual(["Keys 1 L", "Keys 1 R", "Synth L", "Synth R", "Keys Vocal"]);
    expect(t.channels[4].stereoLinkNext).toBe(false);
    const lib: Library = { ...lib0, blockTemplates: [t] };
    expect(LibrarySchema.safeParse(lib).success).toBe(true);
    // Radial ProD2는 내 라이브러리에 없는 마이크 → 템플릿의 사양 사본으로
    let s = add(createEmptyShow(), "drums-8");
    s = insertBlock(s, lib, t.channels, s.inputs.length, true).show;
    expect(micName(s, s.inputs[8])).toBe("Radial ProD2");
    expect(s.inputs[8].stereoLinkNext).toBe(true);
    expect(s.dcas.map((d) => d.name)).toEqual(["Drums", "Keys", "Vox"]);
    expect(s.muteGroups.map((g) => g.name)).toEqual(["Band", "Vox"]);
    expect(parseShow(s).ok).toBe(true);
  });

  it("Show 템플릿: 저장 → 새 Show (id만 새로), 기본 틀 2종", () => {
    const sample = createSampleShow();
    const t = makeShowTemplate("내 밴드 틀", sample);
    const s = showFromTemplate(t, "새 공연");
    expect(s.id).not.toBe(sample.id);
    expect(s.title).toBe("새 공연");
    expect(s.outputs.length).toBe(sample.outputs.length);
    for (const b of BUILTIN_SHOW_TEMPLATES) {
      const x = b.build();
      expect(parseShow(x).ok, b.name).toBe(true);
      expect(warnings(x), b.name).toEqual([]);
    }
    const band = BUILTIN_SHOW_TEMPLATES[0].build();
    expect(busesOf(band, "aux").map((x) => x.name)).toContain("IEM 2");
    expect(band.dcas.length).toBe(6);
  });
});
