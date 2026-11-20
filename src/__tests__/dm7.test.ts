/**
 * DM7 쇼 파일 고쳐 쓰기 검증.
 * 사용자가 DM Editor 2.x에서 직접 바꿔 저장한 샘플을 "정답"으로 삼아, 같은 내용을 OnePatch로 넣었을 때
 * 현재 설정(Current) 데이터가 바이트 단위로 같아지는지 본다.
 * 샘플은 Yamaha 소프트웨어가 만든 파일이라 저장소에 넣지 않는다 → 없으면 건너뛴다.
 *   위치: 환경 변수 DM7_SAMPLES 또는 ~/Documents/vender/dm7
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockData, buildDm7File, findBlock, parseDm7File, type Dm7File } from "@/export/dm7/container";
import { locate, parseSections, readBit, section } from "@/export/dm7/mbdf";
import { allocateBuses, applyDm7, defaultDm7Options, planDm7, type Dm7Item } from "@/export/dm7/dm7Export";
import { exportChecks } from "@/export/checks";
import { createSampleShow } from "@/sample/fivePieceBand";
import { busAccess, rowOps, updateBus } from "@/model/outputOps";
import { createEmptyShow } from "@/model/factory";
import { newChannel } from "@/model/inputOps";
import type { Color, InputChannel, Show } from "@/model/schema";

/** 48V "시트대로 켜기" — 10번 이전 동작. 기존 바이트 일치·실기 검증은 이 설정으로 확인한다 */
const sheetOpts = (show: Show) => ({ ...defaultDm7Options(show), phantomMode: "sheet" as const });

const DIR = process.env.DM7_SAMPLES ?? join(homedir(), "Documents/vender/dm7");
const file = (n: string) => join(DIR, `${n}.dm7f.dmxf`);
const have = ["basic", "name", "color", "patch", "link", "48V_local", "48V_dante"].every((n) => existsSync(file(n)));
const load = (n: string) => parseDm7File(new Uint8Array(readFileSync(file(n))));
const current = (f: Dm7File) => blockData(findBlock(f, "CurrentBackupFile.bup")!);
/** 내부 파일 머리말의 UUID(저장할 때마다 바뀜)는 빼고 비교 */
const body = (b: Uint8Array) => b.subarray(0x48);

/** DM Editor에서 사용자가 한 작업을 OnePatch 데이터로 다시 만든 것 (단계마다 누적) */
function showFor(stage: "name" | "color" | "patch" | "link" | "48V_local" | "48V_dante"): Show {
  const order = ["name", "color", "patch", "link", "48V_local", "48V_dante"];
  const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
  const show = createEmptyShow();
  const rio = show.stageBoxes[0].id;
  const dca = { id: "dca-1", number: 1, name: "" };
  const mute = { id: "mg-1", number: 1, name: "" };
  const colors: Color[] = ["none", "orange", "yellow", "purple", "cyan", "pink", "red", "green", "lime", "white"];
  const names = ["kick", "킥드럼", "abcdefgh"];
  const inputs: InputChannel[] = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    const c: InputChannel = { ...newChannel(n), shortName: names[i] ?? (n < 10 ? `ch ${n}` : `ch${n}`), color: at("color") ? colors[i] : "none" };
    if (at("patch") && n <= 2) c.port = { kind: "stagebox", stageBoxId: rio, port: n }; // Dante 1, 2
    if (at("link")) {
      if (n <= 2) c.dcaIds = [dca.id];
      if (n === 3) c.stereoLinkNext = true;
      if (n === 3) c.muteGroupIds = [mute.id];
    }
    if (at("48V_local") && n === 5) {
      c.port = { kind: "local", port: 1 }; // OMNI 1
      c.phantom = true;
    }
    if (at("48V_dante") && n === 1) c.phantom = true;
    if (n <= 2 && at("48V_local")) c.phantom ??= false;
    return c;
  });
  return { ...show, inputs, dcas: [dca], muteGroups: [mute] };
}

function itemsFor(stage: string): Record<Dm7Item, boolean> {
  const order = ["name", "color", "patch", "link", "48V_local", "48V_dante"];
  const at = (s: string) => order.indexOf(stage) >= order.indexOf(s);
  return { name: true, color: at("color"), icon: false, patch: at("patch"), phantom: at("48V_local"), pair: at("link"), dca: at("link"), mute: at("link"), outPatch: false, busNames: false };
}

describe.skipIf(!have)("DM7 쇼 파일 (샘플 필요)", () => {
  it("컨테이너: 읽고 그대로 다시 쓰면 원본과 바이트가 같다", () => {
    for (const n of ["basic", "link"]) {
      const raw = new Uint8Array(readFileSync(file(n)));
      const f = parseDm7File(raw);
      expect(f.model).toBe("DM7C");
      expect(f.blocks.map((b) => b.name)).toContain("CurrentBackupFile.bup");
      expect(Buffer.from(buildDm7File(f)).equals(Buffer.from(raw))).toBe(true);
    }
  });

  it("스키마로 계산한 위치가 샘플 비교에서 찾은 위치와 같다", () => {
    const cur = current(load("basic"));
    const secs = parseSections(cur);
    const mix = section(secs, "Mixing");
    const proc = section(secs, "Processing");
    expect(locate(mix, [["InputChannel", 0], "Label", "Name"]).pos).toBe(0x5b3e);
    expect(locate(mix, [["InputChannel", 1], "Label", "Name"]).pos).toBe(0x6237);
    expect(locate(mix, [["InputChannel", 0], "InPatch", ["Bank", 0], "Source"]).pos).toBe(0x5b34 + 95);
    expect(locate(mix, [["InputChannel", 0], "DCA", "Assign"]).pos).toBe(0x5b34 + 1767);
    expect(locate(mix, ["DanteRemoteControl", ["IOUnit", 0], ["InputPort", 0], "HeadAmp", "48V"]).pos).toBe(0x49790);
    expect(locate(proc, ["Omni", ["InputPort", 0], "HeadAmp", "48V"]).pos).toBe(0x51eb5);
  });

  for (const stage of ["name", "color", "patch", "link", "48V_local", "48V_dante"] as const) {
    it(`DM Editor에서 직접 바꾼 결과(${stage})와 같은 데이터를 만든다`, () => {
      const base = load("basic");
      const show = showFor(stage);
      const opts = { ...sheetOpts(show), items: itemsFor(stage) };
      const plan = planDm7(show, base, opts);
      const expected = current(load(stage));
      const got = plan.current;
      expect(got.length).toBe(expected.length);
      const diffAt = body(got).findIndex((v, i) => v !== body(expected)[i]);
      expect(diffAt, `처음 다른 위치 ${(diffAt + 0x48).toString(16)}`).toBe(-1);
      // 파일로 만들었다가 다시 읽어도 같다
      const rebuilt = parseDm7File(buildDm7File(applyDm7(base, plan)));
      expect(Buffer.from(body(current(rebuilt))).equals(Buffer.from(body(expected)))).toBe(true);
    });
  }

  it("바뀐 내용 목록과 경고", () => {
    const base = load("basic");
    const show = showFor("48V_dante");
    show.inputs[0].shortName = "KickInsideMic"; // 8자 넘음
    show.inputs.push({ ...newChannel(80), shortName: "far" }); // DM7C 72채널 밖
    const plan = planDm7(show, base, { ...sheetOpts(show), items: { ...itemsFor("48V_dante") } });
    const fields = plan.changes.map((c) => `${c.ch} ${c.field}: ${c.before} → ${c.after}`);
    expect(fields).toContain("1 이름: ch 1 → KickInsi");
    expect(fields).toContain("2 패치: OMNI 2 → Dante 2");
    expect(fields).toContain("3 페어: 단독 → 페어 L (3–4)");
    expect(fields).toContain("4 뮤트: — → 1");
    expect(fields).toContain("5 48V (OMNI 1): 꺼짐 → 켜짐");
    // 8자 넘는 이름은 내보내기 전 점검에서 잡고, 그대로 내보내면 자른다
    expect(exportChecks(show, plan.profile).map((c) => (c.kind === "name" ? `${c.target} ${c.current} → ${c.suggestion}` : c.kind))).toEqual(
      expect.arrayContaining(["Ch 1 KickInsideMic → KckInsdM"]),
    );
    expect(plan.notes.join("\n")).toMatch(/72채널/);
  });
});

const haveOut = have && existsSync(join(DIR, "outpatch2.dmxf"));
const onlyOut: Record<Dm7Item, boolean> = { name: false, color: false, icon: false, patch: false, phantom: false, pair: false, dca: false, mute: false, outPatch: true, busNames: false };

describe.skipIf(!haveOut)("DM7 아웃풋 패치 (샘플 필요)", () => {
  it("Matrix 1 → OMNI OUT 1, Stereo L/R → OMNI OUT 2/3: DM Editor 결과와 바이트까지 같다", () => {
    let show = createEmptyShow(); // Main L/R(스테레오), Mono/Sub
    show = updateBus(show, "main", 0, { ports: [{ kind: "local", port: 2 }, { kind: "local", port: 3 }] });
    show = rowOps(busAccess("matrix")).append(show);
    show = updateBus(show, "matrix", 0, { ports: [{ kind: "local", port: 1 }] });
    const plan = planDm7(show, load("basic"), { ...sheetOpts(show), items: onlyOut });
    const expected = current(parseDm7File(new Uint8Array(readFileSync(join(DIR, "outpatch2.dmxf")))));
    expect(Buffer.from(body(plan.current)).equals(Buffer.from(body(expected)))).toBe(true);
    expect(plan.changes.map((c) => `${c.target} ${c.before} → ${c.after}`)).toEqual([
      "OMNI OUT 1 Mix 1 → Matrix 1",
      "OMNI OUT 2 Mix 2 → Stereo A L",
      "OMNI OUT 3 Mix 3 → Stereo A R",
    ]);
  });

  it.skipIf(!existsSync(join(DIR, "outpatch.dmxf")))("Mix 2 → Dante OUT 1 (박스 1번 출력)", () => {
    let show = createEmptyShow();
    const rio = show.stageBoxes[0].id;
    show = rowOps(busAccess("aux")).append(rowOps(busAccess("aux")).append(show));
    show = updateBus(show, "aux", 1, { ports: [{ kind: "stagebox", stageBoxId: rio, port: 1 }] });
    const plan = planDm7(show, load("basic"), { ...sheetOpts(show), items: onlyOut });
    const expected = current(parseDm7File(new Uint8Array(readFileSync(join(DIR, "outpatch.dmxf")))));
    const at = locate(section(parseSections(expected), "Processing"), ["Dante", ["OutputPort", 0], "Patch", "Source"]).pos;
    expect([...plan.current.subarray(at, at + 4)]).toEqual([...expected.subarray(at, at + 4)]);
    expect(plan.changes.map((c) => `${c.target} ${c.after}`)).toEqual(["Dante OUT 1 Mix 2"]);
  });

  it.skipIf(!existsSync(join(DIR, "outpatch3.dmxf")))("Mono/Sub(둘째 Main) → Stereo B → OMNI OUT 1: DM Editor 결과와 바이트까지 같다", () => {
    let show = createEmptyShow();
    show = updateBus(show, "main", 1, { ports: [{ kind: "local", port: 1 }] });
    const plan = planDm7(show, load("basic"), { ...sheetOpts(show), items: onlyOut });
    const expected = current(parseDm7File(new Uint8Array(readFileSync(join(DIR, "outpatch3.dmxf")))));
    expect(Buffer.from(body(plan.current)).equals(Buffer.from(body(expected)))).toBe(true);
    expect(plan.changes.map((c) => `${c.target} ${c.before} → ${c.after}`)).toEqual(["OMNI OUT 1 Mix 1 → Stereo B L"]);
  });

  it("쓰지 않는 출력 비우기: 박스 범위와 OMNI OUT만", () => {
    const show = createSampleShow();
    const plan = planDm7(show, load("basic"), { ...sheetOpts(show), items: onlyOut, clearUnusedOutputs: true });
    const cleared = plan.changes.filter((c) => c.after === "없음").map((c) => c.target);
    expect(cleared).toContain("Dante OUT 14"); // Rio3224 출력 14번은 비어 있음
    expect(cleared.some((t) => /Dante OUT (2[5-9]|[3-9]\d)/.test(t ?? ""))).toBe(false); // 박스 범위(1–24) 밖은 건드리지 않음
  });
});

describe("DM7 버스 배정", () => {
  it("Aux는 행 순서대로, 스테레오는 홀수에서 시작하는 Mix 두 개", () => {
    const warnings: string[] = [];
    const a = allocateBuses(createSampleShow(), (w) => warnings.push(w));
    expect(a.map((x) => `${x.bus.name}=${x.label}`)).toEqual([
      "Vo Wedge=Mix 1", "Gt Wedge=Mix 2", "Bs Wedge=Mix 3", "Ky Wedge=Mix 4",
      "Drum IEM=Mix 5/6", "Vo IEM=Mix 7/8", "SideFill=Mix 9/10", "FX1 Rev=Mix 11/12", "FX2 Dly=Mix 13/14",
      "Frt Fill=Matrix 1", "Delay=Matrix 3/4", "Rec=Matrix 5/6", "Main LR=Stereo A",
    ]);
    expect(warnings.join()).toMatch(/Bus Setup/);
  });
});

const BUSNAME = join(DIR, "busmane.dm7f.dmxf");
describe.skipIf(!have || !existsSync(BUSNAME))("DM7 버스·DCA·뮤트 이름 (샘플 필요)", () => {
  it("Mix 1 WEDGE1, DCA 1 DRUMS, 뮤트 1 BUSMANE: DM Editor 결과와 같다 (샘플에서 함께 바뀐 Mix 1 뮤트 배정 1바이트 제외)", () => {
    let show = createEmptyShow();
    show = rowOps(busAccess("aux")).append(show);
    show = updateBus(show, "aux", 0, { name: "WEDGE1" });
    show = updateBus(show, "main", 0, { name: "" });
    show = updateBus(show, "main", 1, { name: "" });
    show = { ...show, dcas: [{ id: "d1", number: 1, name: "DRUMS" }], muteGroups: [{ id: "m1", number: 1, name: "BUSMANE" }] };
    const items = { ...onlyOut, outPatch: false, busNames: true };
    const plan = planDm7(show, load("basic"), { ...sheetOpts(show), items });
    const expected = current(parseDm7File(new Uint8Array(readFileSync(BUSNAME))));
    const mute = locate(section(parseSections(expected), "Mixing"), [["Mix", 0], "MuteGroup", "Assign"]).pos;
    const diff = [...body(plan.current)].flatMap((v, i) => (v !== body(expected)[i] ? [i + 0x48] : []));
    expect(diff).toEqual([mute]);
    expect(plan.changes.map((c) => `${c.target} ${c.before} → ${c.after}`)).toEqual([
      "Mix 1 MX 1 → WEDGE1",
      "DCA 1 DCA 1 → DRUMS",
      "뮤트 그룹 1 Mute 1 → BUSMANE",
    ]);
  });

  it("샘플 Show: 스테레오 버스는 두 Mix 모두, Main은 Stereo A L/R, 8자 넘으면 자르기", () => {
    const show = updateBus(createSampleShow(), "aux", 0, { name: "Lead Vo Wedge" });
    const items = { ...onlyOut, outPatch: false, busNames: true };
    const plan = planDm7(show, load("basic"), { ...sheetOpts(show), items });
    const names = plan.changes.map((c) => `${c.target}=${c.after}`);
    expect(names).toEqual(expect.arrayContaining(["Mix 1=Lead Vo", "Mix 5=Drum IEM", "Mix 6=Drum IEM", "Stereo A L=Main LR", "Stereo A R=Main LR", "DCA 1=Drums", "뮤트 그룹 1=Band"]));
    expect(plan.warnings).toEqual([]);
    expect(exportChecks(show, plan.profile).find((c) => c.kind === "name")).toMatchObject({ target: "Aux 1", current: "Lead Vo Wedge" });
  });
});

/* 8-C 실기 샘플: DM7 Compact FW V2.0 + Rio1608-D 1대(UNIT ID #1), 콘솔에서 저장 */
const rioFile = (n: string) => join(DIR, `${n}.dmxf`);
const haveRio = ["rio_base", "rio_48V_1", "rio_48V_5"].every((n) => existsSync(rioFile(n)));
const loadRio = (n: string) => parseDm7File(new Uint8Array(readFileSync(rioFile(n))));
const none: Record<Dm7Item, boolean> = { ...onlyOut, outPatch: false };

describe.skipIf(!haveRio)("DM7 Rio 연결 샘플 (8-C, 샘플 필요)", () => {
  function rioShow(local5 = false): Show {
    const show = createEmptyShow();
    const rio = show.stageBoxes[0].id;
    const ch1: InputChannel = { ...newChannel(1), port: { kind: "stagebox", stageBoxId: rio, port: 1 }, phantom: true };
    const ch2: InputChannel = { ...newChannel(2), port: { kind: "local", port: 5 }, phantom: true };
    return { ...show, inputs: local5 ? [ch1, ch2] : [ch1] };
  }

  it("Rio UNIT ID #1 = I/O 유닛 1: 기본 설정으로 Ch1 → Dante 1 + Rio 1번 48V가 콘솔 저장 결과와 같다", () => {
    const show = rioShow();
    const opts = sheetOpts(show);
    expect(opts.boxes[show.stageBoxes[0].id].ioUnit).toBe(1);
    const plan = planDm7(show, loadRio("rio_base"), { ...opts, items: { ...none, patch: true, phantom: true } });
    const expected = current(loadRio("rio_48V_1"));
    expect(body(plan.current)).toEqual(body(expected));
    const mixing = section(parseSections(expected), "Mixing");
    const p = locate(mixing, ["DanteRemoteControl", ["IOUnit", 0], ["InputPort", 0], "HeadAmp", "48V"]);
    expect(p.pos).toBe(0x49790);
  });

  /* 10번: 48V 처리 */
  const bitsAt = (cur: Uint8Array) => {
    const secs = parseSections(cur);
    return [
      readBit(cur, locate(section(secs, "Mixing"), ["DanteRemoteControl", ["IOUnit", 0], ["InputPort", 0], "HeadAmp", "48V"])),
      readBit(cur, locate(section(secs, "Processing"), ["Omni", ["InputPort", 4], "HeadAmp", "48V"])),
    ];
  };
  it("48V 기본값(끄기): 48V가 켜진 기준 파일로 내보내면 패치된 포트(Rio 1, OMNI 5)의 48V가 모두 꺼진다", () => {
    const show = rioShow(true);
    const base = loadRio("rio_48V_5");
    expect(bitsAt(current(base))).toEqual([true, true]);
    const opts = defaultDm7Options(show);
    expect(opts.phantomMode).toBe("off");
    const plan = planDm7(show, base, opts);
    expect(bitsAt(plan.current)).toEqual([false, false]);
    expect(plan.changes.filter((c) => c.item === "phantom").map((c) => `${c.field} ${c.before}→${c.after}`)).toEqual([
      "48V (I/O 유닛 1 포트 1) 켜짐→꺼짐",
      "48V (OMNI 5) 켜짐→꺼짐",
    ]);
    expect(plan.warnings.some((w) => w.includes("팬텀"))).toBe(false);
  });
  it("48V 그대로 두기: 기준 파일의 48V를 건드리지 않는다 / 시트대로 켜기: 경고", () => {
    const show = rioShow(true);
    const keep = planDm7(show, loadRio("rio_48V_5"), { ...defaultDm7Options(show), phantomMode: "keep" });
    expect(bitsAt(keep.current)).toEqual([true, true]);
    expect(keep.changes.some((c) => c.item === "phantom")).toBe(false);
    const sheet = planDm7(show, loadRio("rio_base"), { ...defaultDm7Options(show), phantomMode: "sheet" });
    expect(bitsAt(sheet.current)).toEqual([true, true]);
    expect(sheet.warnings.some((w) => w.includes("마이크 연결 전에 팬텀이 걸립니다"))).toBe(true);
  });

  it("OMNI 5 48V (rio_48V_5 샘플에서 함께 켜진 것)도 같은 자리에 쓴다", () => {
    const show = rioShow(true);
    const plan = planDm7(show, loadRio("rio_48V_1"), { ...sheetOpts(show), items: { ...none, phantom: true } });
    expect(body(plan.current)).toEqual(body(current(loadRio("rio_48V_5"))));
  });
});
