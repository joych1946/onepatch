/** 예전 저장본 자동 변환 (마이너 업데이트) */
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { LibrarySchema } from "@/model/library";
import { parseShow } from "@/model/serialize";
import { resolveStand } from "@/model/derive";

/** JSON 왕복 후 문자열 치환으로 예전 저장본을 흉내 낸다 */
const old = <T>(x: T, from: string, to: string): unknown => JSON.parse(JSON.stringify(x).replaceAll(from, to));

describe("스탠드 이름: 톨붐 → 롱T, 숏붐 → 숏T (4번)", () => {
  it("예전 Show를 열면 새 이름으로 보이고, 직접 입력한 다른 이름은 그대로", () => {
    const s = createSampleShow();
    s.inputs[0].stand = "톨붐";
    s.inputs[1].stand = "마이크 클립";
    const raw = old(old(s, '"롱T"', '"톨붐"'), '"숏T"', '"숏붐"');
    expect(JSON.stringify(raw)).toContain("숏붐");
    const r = parseShow(raw);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.show.inputs[0].stand).toBe("롱T");
    expect(r.show.inputs[1].stand).toBe("마이크 클립");
    expect(JSON.stringify(r.show)).not.toMatch(/톨붐|숏붐/);
    const sm58 = r.show.microphones.find((m) => m.model === "Shure SM58")!;
    expect(sm58.defaultStand).toBe("롱T");
    expect(resolveStand(r.show, { ...r.show.inputs[2], stand: null, mic: { kind: "library", microphoneId: sm58.id } })).toBe("롱T");
  });

  it("예전 내 라이브러리(마이크 기본 스탠드·템플릿)도 새 이름으로", () => {
    const lib = createDefaultLibrary();
    lib.blockTemplates = [{ id: "b1", name: "보컬", channels: [{ source: "Vox", shortName: "Vox", performer: "", mic: null, customMic: "", stand: "숏T", phantom: null, stereoLinkNext: false, color: "none", dcas: [], mutes: [], notes: "" }] }];
    lib.showTemplates = [{ id: "t1", name: "밴드", show: createSampleShow() }];
    const raw = old(old(lib, '"롱T"', '"톨붐"'), '"숏T"', '"숏붐"');
    const parsed = LibrarySchema.parse(raw);
    expect(JSON.stringify(parsed)).not.toMatch(/톨붐|숏붐/);
    expect(parsed.microphones.find((m) => m.id === "mic-sm58")!.defaultStand).toBe("롱T");
    expect(parsed.blockTemplates[0].channels[0].stand).toBe("숏T");
  });
});
