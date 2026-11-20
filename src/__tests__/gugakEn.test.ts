/** 8번: 국악기 영문 이름 */
import { describe, expect, it } from "vitest";
import { createDefaultLibrary, upgradeLibrary } from "@/model/libraryDefaults";
import { channelsOf, findSource, LibrarySchema, localizeShow, sourceMatchesQuery, SHORT_NAME_MAX } from "@/model/library";
import { applySourcePick } from "@/model/pickFlow";
import { createEmptyShow } from "@/model/factory";
import { matchSource } from "@/export/importShow";
import { norm } from "@/model/text";

const lib = createDefaultLibrary();
const gugak = lib.sources.filter((s) => s.groupId.startsWith("grp-gugak"));
const src = (name: string) => lib.sources.find((s) => s.name === name)!;

describe("국악기 영문 이름 (8번)", () => {
  it("모든 국악 소스에 로마자 영문 이름", () => {
    expect(Object.fromEntries(gugak.map((s) => [s.name, s.nameEn]))).toMatchObject({
      가야금: "Gayageum", 거문고: "Geomungo", 대아쟁: "Dae-ajaeng", 소아쟁: "So-ajaeng", 해금: "Haegeum", 양금: "Yanggeum",
      대금: "Daegeum", 소금: "Sogeum", 단소: "Danso", 피리: "Piri", 태평소: "Taepyeongso", 생황: "Saenghwang",
      "장구 궁편": "Janggu Gungpyeon", "장구 채편": "Janggu Chaepyeon", 소리북: "Soribuk", 풍물북: "Pungmulbuk",
      꽹과리: "Kkwaenggwari", 징: "Jing", 대북: "Daebuk", 모듬북: "Modeumbuk",
    });
    for (const s of gugak) expect(s.nameEn, s.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9 -]*$/);
  });

  it("짧은 이름은 8자를 넘을 때만 줄이고, 번호·L/R을 붙여도 8자 이하", () => {
    for (const s of gugak) {
      // 띄어쓰기·붙임표 없는 8자 이하 영문 이름은 줄이지 않는다
      if (/^[A-Za-z0-9]{1,8}$/.test(s.nameEn)) expect(s.shortName, s.name).toBe(s.nameEn);
      expect(s.shortName.length, s.name).toBeLessThanOrEqual(SHORT_NAME_MAX);
      for (const n of [undefined, 1, 9, 10, 12])
        for (const c of channelsOf({ ...s, stereo: false }, n)) expect(c.shortName.length, `${s.name} ${n}`).toBeLessThanOrEqual(SHORT_NAME_MAX);
      for (const c of channelsOf({ ...s, stereo: true }, 12)) expect(c.shortName.length, `${s.name} 12 L/R`).toBeLessThanOrEqual(SHORT_NAME_MAX);
    }
    expect(src("가야금").shortName).toBe("Gayageum");
  });

  it("\"Haegeum\"과 \"해금\" 둘 다로 검색된다", () => {
    for (const q of ["Haegeum", "해금", "haeg"]) expect(lib.sources.filter((s) => sourceMatchesQuery(s, norm(q))).map((s) => s.name)).toContain("해금");
    expect(findSource(lib, "Haegeum 2")).toMatchObject({ src: { id: "src-haegeum" }, num: 2, lang: "en" });
    expect(findSource(lib, "해금 2")).toMatchObject({ src: { id: "src-haegeum" }, num: 2, lang: "ko" });
  });

  it("누르기 입력에서 영문으로 넣기, 출력물은 한글/영문 선택", () => {
    let s = applySourcePick(createEmptyShow(), lib, 0, { kind: "library", src: src("해금") }, true, "en").show;
    s = applySourcePick(s, lib, 1, { kind: "library", src: src("해금") }, true, "en").show;
    expect(s.inputs.map((c) => c.source)).toEqual(["Haegeum 1", "Haegeum 2"]);
    s = applySourcePick(s, lib, 2, { kind: "library", src: src("대금") }, true, "ko").show;
    s = { ...s, inputs: [...s.inputs, { ...s.inputs[2], id: "x", number: 9, source: "Vocal" }] };
    expect(localizeShow(s, lib, "ko").inputs.map((c) => c.source)).toEqual(["해금 1", "해금 2", "대금 1", "Vocal"]);
    expect(localizeShow(s, lib, "en").inputs.map((c) => c.source)).toEqual(["Haegeum 1", "Haegeum 2", "Daegeum 1", "Vocal"]);
  });

  it("콘솔 이름 읽기: 영문 이름, 줄인 번호 이름, 예전 짧은 이름(Gaya)", () => {
    const m = (n: string) => matchSource(n, lib.sources)?.source;
    expect(m("Gayageum")).toBe("가야금");
    expect(m("Gayagem2")).toBe("가야금 2");
    expect(m("Gaya2")).toBe("가야금 2");
    expect(m("Taepyeongso")).toBe("태평소");
  });

  it("저장본 업그레이드: 영문 이름을 채우고, 내가 고친 짧은 이름은 그대로", () => {
    const raw = JSON.parse(JSON.stringify(lib));
    raw.seedVersion = 3;
    for (const s of raw.sources) delete s.nameEn;
    raw.sources.find((s: { id: string }) => s.id === "src-gayageum").shortName = "Gaya"; // 예전 기본값 그대로
    raw.sources.find((s: { id: string }) => s.id === "src-haegeum").shortName = "HG"; // 내가 고친 값
    raw.sources.find((s: { id: string }) => s.id === "src-daegeum").shortName = "Gaya"; // 다른 소스의 같은 글자는 내가 고친 것
    const up = upgradeLibrary(LibrarySchema.parse(raw));
    const get = (id: string) => up.sources.find((s) => s.id === id)!;
    expect(get("src-gayageum")).toMatchObject({ nameEn: "Gayageum", shortName: "Gayageum" });
    expect(get("src-haegeum")).toMatchObject({ nameEn: "Haegeum", shortName: "HG" });
    expect(get("src-daegeum").shortName).toBe("Gaya");
    expect(upgradeLibrary(up)).toBe(up);
  });
});
