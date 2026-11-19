/** 8-D: 기준 파일 정보, 내보내기 전 점검, 아이콘 자동 지정, 콘솔 할 일, 결과 요약, 콘솔 프로필 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createEmptyShow } from "@/model/factory";
import { newChannel } from "@/model/inputOps";
import { checkShow } from "@/model/schema";
import { suggestShortName } from "@/model/text";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { quantityIssues } from "@/model/library";
import { CONSOLE_PROFILES, DEFAULT_CONSOLE_PROFILE, profileByModel } from "@/export/profile";
import { pickIcon } from "@/export/icons";
import { applyNameFix, exportChecks } from "@/export/checks";
import { consoleTasks } from "@/export/dm7/tasks";
import { blockData, buildDm7File, parseDm7File } from "@/export/dm7/container";
import { dm7FileInfo } from "@/export/dm7/fileInfo";
import { applyDm7, defaultDm7Options, planDm7 } from "@/export/dm7/dm7Export";

const P = DEFAULT_CONSOLE_PROFILE;
const lib = createDefaultLibrary();
const DIR = process.env.DM7_SAMPLES ?? join(homedir(), "Documents/vender/dm7");
const BASIC = join(DIR, "basic.dm7f.dmxf");
const haveBasic = existsSync(BASIC);
const loadBasic = () => parseDm7File(new Uint8Array(readFileSync(BASIC)));
const allChecks = (show: ReturnType<typeof createSampleShow>, colorMap = {}) =>
  exportChecks(show, P, { colorMap, issues: [...checkShow(show, { nameMax: P.nameMax }).warnings, ...quantityIssues(lib, show)] });

describe("콘솔 프로필", () => {
  it("DM7 Compact이 주력, 기종 코드로 찾는다", () => {
    expect(P).toMatchObject({ id: "dm7c", nameMax: 8, inputs: 72, mixes: 48, matrices: 12, dcas: 24, muteGroups: 12 });
    expect(profileByModel("DM7").inputs).toBe(120);
    for (const p of CONSOLE_PROFILES) {
      expect(p.icons).toContain(p.iconBlank);
      for (const icon of [...Object.values(p.iconBySource), ...Object.values(p.iconByGroup), ...p.iconRules.map((r) => r[1])]) expect(p.icons).toContain(icon);
      for (const c of Object.values(p.colorMap)) expect(p.colors.map((x) => x.value)).toContain(c.value);
    }
  });

  it("오류 검사의 이름 글자 수 기준은 프로필 값을 쓴다", () => {
    const show = createSampleShow();
    expect(checkShow(show, { nameMax: P.nameMax }).warnings).toEqual([]);
    expect(checkShow(show, { nameMax: 4 }).warnings.some((w) => w.code === "short-name")).toBe(true);
  });
});

describe("내보내기 전 점검", () => {
  it("샘플 Show는 경고 0개", () => {
    expect(allChecks(createSampleShow())).toEqual([]);
  });

  it("9자 이름은 잡히고, 제안을 받아들이면 경고가 없어진다", () => {
    let show = createSampleShow();
    show = { ...show, inputs: show.inputs.map((c, i) => (i === 0 ? { ...c, shortName: "KickInMic" } : c)) };
    const checks = allChecks(show);
    expect(checks).toHaveLength(1);
    const c = checks[0];
    if (c.kind !== "name") throw new Error("이름 점검이어야 함");
    expect(c).toMatchObject({ target: "Ch 1", current: "KickInMic" });
    expect([...c.suggestion].length).toBeLessThanOrEqual(8);
    show = applyNameFix(show, c.ref, c.suggestion);
    expect(show.inputs[0].shortName).toBe(c.suggestion);
    expect(allChecks(show)).toEqual([]);
  });

  it("버스·DCA·뮤트 그룹 이름, 짧은 이름이 없으면 소스명도 본다", () => {
    let show = createSampleShow();
    show = { ...show, dcas: show.dcas.map((d, i) => (i === 0 ? { ...d, name: "Drums All" } : d)), inputs: show.inputs.map((c, i) => (i === 1 ? { ...c, shortName: "", source: "Kick Outside" } : c)) };
    expect(allChecks(show).map((c) => (c.kind === "name" ? c.target : c.kind))).toEqual(["Ch 2", "DCA 1"]);
  });

  it("줄인 이름 제안", () => {
    expect(suggestShortName("Front Fill", 8)).toBe("FrntFill");
    expect(suggestShortName("Bass Wedge", 8)).toBe("BassWedg");
    expect(suggestShortName("Gtr Wedge", 8)).toBe("GtrWedge");
    expect(suggestShortName("25현 가야금 소리꾼", 8)).toBe("25현가야금소리");
    expect(suggestShortName("Kick", 8)).toBe("Kick");
  });

  it("콘솔에 없는 컬러: 가까운 컬러를 제안하고, 고르면 해결되고 그 값으로 내보낸다", () => {
    let show = createSampleShow();
    show = { ...show, inputs: show.inputs.map((c, i) => (i === 0 ? { ...c, color: "brown" as const } : c)) };
    expect(allChecks(show)).toEqual([expect.objectContaining({ kind: "color", color: "brown", suggestion: "Orange", channels: [1] })]);
    expect(allChecks(show, { brown: "Red" })).toEqual([]);
  });

  it("기종 한도: 72채널, DCA 24, 뮤트 12, Mix 48", () => {
    let show = createEmptyShow();
    show = {
      ...show,
      inputs: [newChannel(1), newChannel(73)],
      dcas: [{ id: "d25", number: 25, name: "" }],
      muteGroups: [{ id: "m13", number: 13, name: "" }],
    };
    const msgs = exportChecks(show, P).filter((c) => c.kind === "limit").map((c) => (c.kind === "limit" ? c.message : ""));
    expect(msgs.join("\n")).toMatch(/72채널.*Ch 73/);
    expect(msgs.join("\n")).toMatch(/DCA 25/);
    expect(msgs.join("\n")).toMatch(/뮤트 그룹 13/);
  });
});

describe("아이콘 자동 지정", () => {
  it("샘플 Show: 소스 목록·이름 규칙, 보컬은 이름이 먼저, 맞는 것이 없으면 Blank", () => {
    const show = createSampleShow();
    const icons = show.inputs.map((c) => `${c.number}:${pickIcon(P, show, c, lib.sources)}`);
    expect(icons).toEqual([
      "1:Kick", "2:Kick", "3:Snare", "4:Snare", "5:Hi-Hat", "6:Tom", "7:F.Tom", "8:F.Tom", "9:Cymbal", "10:Cymbal",
      "11:E.Bass", "12:BassAmp", "13:E.Guitar", "14:E.Guitar", "15:A.Guitar", "16:A.Guitar", "17:Keyboard", "18:Keyboard", "19:Keyboard", "20:Keyboard",
      "21:Wireless", "22:Dynamic", "23:Dynamic", "24:Dynamic", "25:Wireless", "26:Dynamic",
    ]);
  });

  it("소스 목록의 악기군 (국악 현악 → Strings), 관찰되지 않은 악기는 Blank", () => {
    const show = createEmptyShow();
    const ch = (source: string, shortName = "") => ({ ...newChannel(1), source, shortName });
    expect(pickIcon(P, show, ch("가야금 2", "Gaya2"), lib.sources)).toBe("Strings");
    expect(pickIcon(P, show, ch("E.Gtr 1"), lib.sources)).toBe("GuitarAmp");
    expect(pickIcon(P, show, ch("징"), lib.sources)).toBe("Cymbal");
    expect(pickIcon(P, show, ch("대금"), lib.sources)).toBe("Blank");
    expect(pickIcon(P, show, ch("Trumpet"), lib.sources)).toBe("Blank");
    expect(pickIcon(P, show, ch("MR", "MR L"), lib.sources)).toBe("Media1");
  });
});

describe("콘솔에서 직접 할 일", () => {
  it("샘플 Show에 맞춰 뽑는다", () => {
    const tasks = consoleTasks(createSampleShow());
    const text = tasks.map((t) => `${t.section}|${t.target}|${t.task}`);
    expect(text).toEqual(
      expect.arrayContaining([
        "버스·출력|Mix 5/6 Drum IEM|Bus Setup에서 Mix 5/6을(를) 스테레오로",
        "버스·출력|Mix 1 Vo Wedge|센드 Pre로 (Send Point)",
        "인풋 (사운드체크)|Ch 1 Kick In|게인 · HPF · EQ · 다이내믹스",
        "마무리|Scene|현재 상태를 Scene으로 저장 (Store)",
      ]),
    );
    expect(text.some((t) => t.startsWith("준비|Rio3224"))).toBe(true);
    expect(text.some((t) => t.includes("Name Language"))).toBe(false); // 샘플은 영문 이름뿐
  });
});

describe.skipIf(!haveBasic)("DM7 기준 파일 (샘플 필요)", () => {
  it("머리말에서 기종·저장 시각(UTC)을 읽는다", () => {
    expect(dm7FileInfo(loadBasic())).toEqual({ modelName: "Yamaha DM7 Compact", formatVersion: "02 01", savedAt: "2026-11-18T06:32:58.000Z" });
  });

  it("샘플 Show 내보내기: 경고 0개, 항목별 수, 현재 설정 외 블록은 바이트 그대로", () => {
    const show = createSampleShow();
    const base = loadBasic();
    const plan = planDm7(show, base, defaultDm7Options(show), { sources: lib.sources });
    expect(plan.warnings).toEqual([]);
    expect(plan.stats.name.total).toBe(26);
    expect(plan.stats.icon.total).toBe(26);
    expect(plan.stats.patch.total).toBe(26);
    expect(plan.stats.dca.total).toBeGreaterThan(0);
    expect(plan.notes.join()).toMatch(/Bus Setup/);
    const out = parseDm7File(buildDm7File(applyDm7(base, plan)));
    out.blocks.forEach((b, i) => {
      if (b.category === "Current") expect(blockData(b)).toEqual(plan.current);
      else expect(b.compressed).toEqual(base.blocks[i].compressed);
    });
  });
});
