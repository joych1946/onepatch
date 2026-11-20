import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createEmptyShow } from "@/model/factory";
import { createDefaultLibrary, UNVERIFIED_MIC_IDS } from "@/model/libraryDefaults";
import {
  addMic,
  addSource,
  findSource,
  learnPick,
  LibrarySchema,
  micOptions,
  quantityIssues,
  suggestNextSources,
  type Library,
} from "@/model/library";
import { applyMicPick, applySourcePick } from "@/model/pickFlow";
import { micName, resolvePhantom, resolveStand } from "@/model/derive";
import { updateChannel } from "@/model/inputOps";
import { COLUMNS, COL_INDEX } from "@/model/inputColumns";
import { parseShow } from "@/model/serialize";
import { loadLibrary, saveLibrary } from "@/storage/libraryStore";
import { SEED_VERSION, upgradeLibrary } from "@/model/libraryDefaults";
import { channelsOf, fitShortName, SHORT_NAME_MAX } from "@/model/library";
import { db, LIBRARY } from "@/storage/db";

const lib0 = createDefaultLibrary();
const src = (lib: Library, name: string) => lib.sources.find((s) => s.name === name)!;
const mic = (lib: Library, id: string) => lib.microphones.find((m) => m.id === id)!;

/** 소스 → 추천 1순위 마이크를 누르는 한 번의 흐름 */
function pick(show: ReturnType<typeof createEmptyShow>, lib: Library, index: number, name: string, micId?: string) {
  const s = src(lib, name);
  const r = applySourcePick(show, lib, index, { kind: "library", src: s }, true);
  const m = mic(lib, micId ?? s.micIds[0]);
  return { show: applyMicPick(r.show, r.rows, { kind: "library", mic: m }), rows: r.rows };
}

describe("기본 라이브러리", () => {
  it("스키마에 맞고, 마이크 40~60종, id 중복 없음, 추천은 모두 실제 마이크", () => {
    expect(LibrarySchema.safeParse(lib0).success).toBe(true);
    // 유선·DI는 40~60종, 무선 시스템(3판)은 따로 센다
    const wired = lib0.microphones.filter((m) => !m.id.startsWith("mic-w-"));
    expect(wired.length).toBeGreaterThanOrEqual(40);
    expect(wired.length).toBeLessThanOrEqual(60);
    const ids = new Set(lib0.microphones.map((m) => m.id));
    expect(ids.size).toBe(lib0.microphones.length);
    expect(new Set(lib0.sources.map((s) => s.id)).size).toBe(lib0.sources.length);
    for (const s of lib0.sources) {
      // 국악 꽹과리·징·고수 추임새는 요청대로 2개, 나머지는 3개 이상
      expect(s.micIds.length, s.name).toBeGreaterThanOrEqual(s.groupId.startsWith("grp-gugak") ? 2 : 3);
      for (const id of s.micIds) expect(ids.has(id), `${s.name} → ${id}`).toBe(true);
    }
    // 미확인 사양은 비워둔다
    for (const id of UNVERIFIED_MIC_IDS) expect(mic(lib0, id).needsPhantom).toBeNull();
  });

  it("IndexedDB: 처음 열면 기본값, 저장 후 다시 읽으면 같다", async () => {
    const lib = await loadLibrary();
    expect(lib).toEqual(createDefaultLibrary());
    const changed = learnPick(lib, "src-kick-in", "mic-d6");
    await saveLibrary(changed);
    expect(await loadLibrary()).toEqual(changed);
  });
});

describe("누르기 입력", () => {
  it("드럼 8채널: 소스·마이크만 눌러서 48V·스탠드·짧은 이름·컬러가 채워진다", () => {
    let show = createEmptyShow();
    const order = ["Kick In", "Kick Out", "Snare Top", "Hi-Hat", "Tom 1", "Floor Tom", "OH"];
    let row = 0;
    for (const name of order) {
      // 누를 소스가 "다음 추천"에 들어 있다
      expect(suggestNextSources(lib0, show, row).map((x) => x.name)).toContain(name);
      const r = pick(show, lib0, row, name);
      show = r.show;
      row = r.rows[r.rows.length - 1] + 1;
    }
    expect(show.inputs.map((c) => c.source)).toEqual([
      "Kick In", "Kick Out", "Snare Top", "Hi-Hat", "Tom 1", "Floor Tom", "OH L", "OH R",
    ]);
    expect(show.inputs.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const k = show.inputs[0];
    expect(k.shortName).toBe("KickIn");
    expect(k.color).toBe("red");
    expect(micName(show, k)).toBe("Shure Beta 91A");
    expect(resolvePhantom(show, k)).toBe(true);
    expect(resolvePhantom(show, show.inputs[1])).toBe(false);
    expect(resolveStand(show, show.inputs[1])).toBe("숏T");
    // 스테레오: 두 채널 + 링크, 같은 마이크
    expect(show.inputs[6].stereoLinkNext).toBe(true);
    expect(show.inputs[7].stereoLinkNext).toBe(false);
    expect(micName(show, show.inputs[7])).toBe("AKG C414 XLS");
    expect(parseShow(show).ok).toBe(true);
  });

  it("Kick In 다음 제안은 Kick Out, Snare Top", () => {
    const show = pick(createEmptyShow(), lib0, 0, "Kick In").show;
    expect(suggestNextSources(lib0, show, 1).slice(0, 2).map((s) => s.name)).toEqual(["Kick Out", "Snare Top"]);
  });

  it("내가 고친 짧은 이름·컬러·48V·스탠드는 덮어쓰지 않는다", () => {
    let show = pick(createEmptyShow(), lib0, 0, "Kick In").show;
    show = updateChannel(show, 0, { shortName: "BD", color: "orange", phantom: false, stand: "없음" });
    show = pick(show, lib0, 0, "Kick Out").show;
    const c = show.inputs[0];
    expect(c.source).toBe("Kick Out");
    expect([c.shortName, c.color, c.phantom, c.stand]).toEqual(["BD", "orange", false, "없음"]);
    // 자동으로 들어간 값은 새 소스에 맞게 바뀐다
    show = pick(show, lib0, 1, "Snare Top").show;
    show = pick(show, lib0, 1, "Bass DI").show;
    expect([show.inputs[1].shortName, show.inputs[1].color]).toEqual(["BassDI", "yellow"]);
  });

  it("스테레오: 다음 행에 다른 내용이 있으면 덮지 않고 끼워 넣는다", () => {
    let show = pick(createEmptyShow(), lib0, 0, "Kick In").show;
    show = pick(show, lib0, 1, "Lead Vox").show;
    show = pick(show, lib0, 0, "Keys").show; // Kick In 자리를 Keys L/R로
    expect(show.inputs.map((c) => c.source)).toEqual(["Keys L", "Keys R", "Lead Vox"]);
    expect(show.inputs.map((c) => c.number)).toEqual([1, 2, 3]);
    // 같은 자리에 다시 스테레오를 고르면 R 행을 재사용
    show = pick(show, lib0, 0, "Synth").show;
    expect(show.inputs.map((c) => c.source)).toEqual(["Synth L", "Synth R", "Lead Vox"]);
    // 모노로 바꾸면 링크 해제
    show = pick(show, lib0, 0, "Bass DI").show;
    expect(show.inputs[0].stereoLinkNext).toBe(false);
  });

  it("마이크 열에 이름만 쳐도 라이브러리에서 찾아 48V·스탠드가 채워진다", () => {
    let show = createEmptyShow();
    show = { ...show, inputs: [] };
    show = applySourcePick(show, lib0, 0, { kind: "text", name: "Snare" }, true).show;
    show = COLUMNS[COL_INDEX.mic].set(show, 0, "KM184", { catalog: lib0.microphones })!;
    expect(micName(show, show.inputs[0])).toBe("Neumann KM 184");
    expect(resolvePhantom(show, show.inputs[0])).toBe(true);
    expect(resolveStand(show, show.inputs[0])).toBe("롱T");
    expect(parseShow(show).ok).toBe(true);
  });
});

describe("보유 수량과 추천 순서", () => {
  it("보유 수량을 넘으면 그 마이크를 쓰는 채널마다 경고", () => {
    const lib: Library = {
      ...lib0,
      microphones: lib0.microphones.map((m) => (m.id === "mic-sm57" ? { ...m, owned: 1 } : m)),
    };
    let show = pick(createEmptyShow(), lib, 0, "Snare Top", "mic-sm57").show;
    expect(quantityIssues(lib, show)).toEqual([]);
    show = pick(show, lib, 1, "Snare Btm", "mic-sm57").show;
    const issues = quantityIssues(lib, show);
    expect(issues.map((i) => i.path)).toEqual([["inputs", 0, "mic"], ["inputs", 1, "mic"]]);
    expect(issues[0].message).toContain("보유 1개인데 2개 사용");
    const opt = micOptions(lib, show, src(lib, "Snare Top")).recommended.find((o) => o.mic.id === "mic-sm57")!;
    expect(opt.remaining).toBe(-1);
  });

  it("보유한 모델이 추천 목록 앞으로, 추천 순서를 바꾸면 그대로 반영", () => {
    let lib: Library = {
      ...lib0,
      microphones: lib0.microphones.map((m) => (m.id === "mic-e904" ? { ...m, owned: 4 } : m)),
    };
    const show = createEmptyShow();
    const names = () => micOptions(lib, show, src(lib, "Snare Top")).recommended.map((o) => o.mic.id);
    expect(names()).toEqual(["mic-e904", "mic-sm57", "mic-beta57a", "mic-i5"]);
    lib = {
      ...lib,
      sources: lib.sources.map((s) =>
        s.name === "Snare Top" ? { ...s, micIds: ["mic-i5", "mic-beta57a", "mic-sm57", "mic-e904"] } : s,
      ),
    };
    expect(names()).toEqual(["mic-e904", "mic-i5", "mic-beta57a", "mic-sm57"]);
  });

  it("자주 고른 마이크는 추천 목록 위로 올라온다", () => {
    let lib = lib0;
    const id = "src-snare-top";
    lib = learnPick(lib, id, "mic-e904"); // 4번째 → 3번째
    lib = learnPick(lib, id, "mic-e904"); // → 2번째
    expect(src(lib, "Snare Top").micIds.slice(0, 2)).toEqual(["mic-sm57", "mic-e904"]);
    lib = learnPick(lib, id, "mic-c414"); // 목록에 없으면 맨 뒤에 추가
    expect(src(lib, "Snare Top").micIds.at(-1)).toBe("mic-c414");
  });

  it("직접 입력한 소스·마이크를 내 목록에 저장", () => {
    const a = addSource(lib0, "Harp", "grp-strings");
    expect(findSource(a.lib, "Harp")?.src.groupId).toBe("grp-strings");
    const b = addMic(a.lib, "Shure KSM8", "dynamic");
    expect(b.mic.needsPhantom).toBe(false);
    expect(addMic(a.lib, "Mystery Cond", "condenser").mic.needsPhantom).toBeNull();
    expect(LibrarySchema.safeParse(b.lib).success).toBe(true);
  });
});

describe("국악 소스", () => {
  const choose = (show: ReturnType<typeof createEmptyShow>, row: number, name: string) => pick(show, lib0, row, name);

  it("짧은 이름은 번호·L/R이 붙어도 8자 이내, 한글·영문으로 찾을 수 있다", () => {
    for (const s of lib0.sources) {
      for (const n of [undefined, 1, 9])
        for (const c of channelsOf(s, s.numbered ? n : undefined))
          expect(c.shortName.length, `${c.source} → ${c.shortName}`).toBeLessThanOrEqual(SHORT_NAME_MAX);
    }
    expect(fitShortName("Haegeum", "1")).toBe("Haegeum1");
    expect(fitShortName("JangGung", "2")).toBe("JangGng2");
    expect(fitShortName("Gaya", "3")).toBe("Gaya 3");
    // 국악 4군은 기존 악기군과 다른 색
    const old = new Set(lib0.sources.filter((s) => !s.groupId.startsWith("grp-gugak")).map((s) => s.color));
    const gugak = ["grp-gugak-str", "grp-gugak-wind", "grp-gugak-perc", "grp-gugak-vox"].map(
      (g) => lib0.sources.find((s) => s.groupId === g)!.color,
    );
    expect(new Set(gugak).size).toBe(4);
    for (const c of gugak) expect(old.has(c)).toBe(false);
  });

  it("해금: 추천 마이크가 있고, 짧은 이름 Haegeum(번호 포함)", () => {
    const h = src(lib0, "해금");
    expect(micOptions(lib0, createEmptyShow(), h).recommended[0].mic.model).toBe("DPA 4099");
    const c = choose(createEmptyShow(), 0, "해금").show.inputs[0];
    expect([c.source, c.shortName, c.color]).toEqual(["해금 1", "Haegeum1", "brown"]);
  });

  it("가야금을 세 번 고르면 가야금 1, 2, 3", () => {
    let show = createEmptyShow();
    for (let r = 0; r < 3; r++) show = choose(show, r, "가야금").show;
    expect(show.inputs.map((c) => c.source)).toEqual(["가야금 1", "가야금 2", "가야금 3"]);
    expect(show.inputs.map((c) => c.shortName)).toEqual(["Gayagem1", "Gayagem2", "Gayagem3"]);
    // 같은 행에서 다시 골라도 번호 유지, 마이크만 바꿔도 그대로
    show = choose(show, 1, "가야금").show;
    expect(show.inputs[1].source).toBe("가야금 2");
    // 번호 소스는 추천에 다시 나올 수 있다
    expect(findSource(lib0, "가야금 2")?.num).toBe(2);
  });

  it("다음 소스: 장구 궁편 → 장구 채편, 소리 → 고수 추임새·소리북", () => {
    let show = choose(createEmptyShow(), 0, "장구 궁편").show;
    expect(show.inputs[0].source).toBe("장구 궁편 1");
    expect(suggestNextSources(lib0, show, 1)[0].name).toBe("장구 채편");
    show = choose(createEmptyShow(), 0, "소리").show;
    expect(suggestNextSources(lib0, show, 1).slice(0, 2).map((s) => s.name)).toEqual(["고수 추임새", "소리북"]);
  });

  it("추천 마이크는 모두 라이브러리에 있는 모델", () => {
    const ids = new Set(lib0.microphones.map((m) => m.id));
    expect(lib0.microphones.filter((m) => !m.id.startsWith("mic-w-")).length).toBe(57); // 국악 때문에 마이크를 추측해서 추가하지 않음
    for (const s of lib0.sources.filter((x) => x.groupId.startsWith("grp-gugak")))
      for (const id of s.micIds) expect(ids.has(id), `${s.name} → ${id}`).toBe(true);
  });
});

describe("기존 저장본에 새 기본 항목 합치기", () => {
  /** 국악이 들어오기 전(판 1) 저장본을 흉내: 국악 없음, seedVersion·numbered·next 필드 없음 */
  const oldStored = () => {
    const lib = createDefaultLibrary();
    const raw = JSON.parse(JSON.stringify(lib));
    delete raw.seedVersion;
    raw.groups = raw.groups.filter((g: { id: string }) => !g.id.startsWith("grp-gugak"));
    raw.sources = raw.sources
      .filter((s: { groupId: string }) => !s.groupId.startsWith("grp-gugak"))
      .map((src: Record<string, unknown>) => {
        delete src.numbered;
        delete src.next;
        return src;
      });
    // 사용자가 고친 내용
    raw.microphones.find((m: { id: string }) => m.id === "mic-sm57").owned = 6;
    raw.sources.find((s: { id: string }) => s.id === "src-kick-in").micIds = ["mic-d6", "mic-beta91a"];
    raw.sources.find((s: { id: string }) => s.id === "src-snare-top").shortName = "SN";
    raw.sources = raw.sources.filter((s: { id: string }) => s.id !== "src-ride"); // 지운 기본 소스
    return raw;
  };

  it("없는 항목만 추가하고, 고친 내용과 지운 항목은 그대로", () => {
    const parsed = LibrarySchema.parse(oldStored());
    expect(parsed.seedVersion).toBe(1);
    const up = upgradeLibrary(parsed);
    expect(up.seedVersion).toBe(SEED_VERSION);
    expect(up.groups.slice(-4).map((g) => g.name)).toEqual(["국악 현악", "국악 관악", "국악 타악", "국악 성악"]);
    expect(findSource(up, "해금")?.src.shortName).toBe("Haegeum");
    expect(up.microphones.find((m) => m.id === "mic-sm57")!.owned).toBe(6);
    expect(src(up, "Kick In").micIds).toEqual(["mic-d6", "mic-beta91a"]);
    expect(src(up, "Snare Top").shortName).toBe("SN");
    expect(up.sources.some((s) => s.id === "src-ride")).toBe(false);
    expect(upgradeLibrary(up)).toBe(up); // 두 번 해도 그대로
  });

  it("무선 시스템(3판): 저장본에 없는 것만 합치고, 보유 수량·고친 내용·같은 이름 모델은 그대로", () => {
    const raw = JSON.parse(JSON.stringify(createDefaultLibrary()));
    raw.seedVersion = 2;
    raw.microphones = raw.microphones.filter((m: { id: string }) => !m.id.startsWith("mic-w-"));
    raw.microphones.find((m: { id: string }) => m.id === "mic-ulxd-b58").owned = 4;
    raw.microphones.find((m: { id: string }) => m.id === "mic-ulxd-b58").model = "ULXD 핸드헬드 B58 (내 이름)";
    // 내가 직접 넣어 둔 모델 (기본 목록과 같은 이름)
    raw.microphones.push({ id: "mic-u-mine", model: "Shure QLX-D QLXD2 (KSM9)", type: "wireless", needsPhantom: false, defaultStand: "", owned: 2, builtin: false });
    const before = raw.microphones.length;
    const up = upgradeLibrary(LibrarySchema.parse(raw));
    const addedIds = up.microphones.slice(before).map((m) => m.id);
    expect(addedIds.length).toBeGreaterThan(50);
    expect(addedIds.every((id) => id.startsWith("mic-w-"))).toBe(true);
    expect(up.microphones.filter((m) => m.model === "Shure QLX-D QLXD2 (KSM9)")).toHaveLength(1);
    expect(up.microphones.find((m) => m.id === "mic-ulxd-b58")).toMatchObject({ owned: 4, model: "ULXD 핸드헬드 B58 (내 이름)" });
    expect(up.microphones.every((m) => m.type !== "wireless" || m.needsPhantom === false)).toBe(true);
    // 이미 있던 조합(ULX-D SM58·Beta 58A, QLX-D Beta 58A, G4 MMD 935)은 겹쳐 넣지 않는다
    const models = up.microphones.map((m) => m.model);
    expect(models.filter((m) => /ULX-D ULXD2 \((SM58|Beta 58A)\)|QLX-D QLXD2 \(Beta 58A\)|ew G4 .*\(MMD 935\)/.test(m))).toEqual([]);
    expect(new Set(up.microphones.map((m) => m.id)).size).toBe(up.microphones.length);
    expect(upgradeLibrary(up)).toBe(up);
  });

  it("IndexedDB: 예전 저장본을 열면 합쳐서 다시 저장", async () => {
    await (await db()).put(LIBRARY, oldStored(), "user");
    const lib = await loadLibrary();
    expect(findSource(lib, "가야금 1")?.src.name).toBe("가야금");
    expect(lib.microphones.find((m) => m.id === "mic-sm57")!.owned).toBe(6);
    const again: { seedVersion: number } = await (await db()).get(LIBRARY, "user");
    expect(again.seedVersion).toBe(SEED_VERSION);
  });
});
