/** 10단계: DM7 쇼 파일 → Show (왕복, 콘솔 변경분, 실제 공연 파일) */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createEmptyShow } from "@/model/factory";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { checkShow, ShowSchema, type PortRef, type Show } from "@/model/schema";
import { resolvePhantom } from "@/model/derive";
import { blockData, buildDm7File, findBlock, parseDm7File, type Dm7File } from "@/export/dm7/container";
import { allocateBuses, applyDm7, defaultDm7Options, planDm7, type Dm7Options } from "@/export/dm7/dm7Export";
import { readDm7 } from "@/export/dm7/dm7Import";
import { locate, parseSections, section, writeBit, writeString } from "@/export/dm7/mbdf";
import { consoleColor, DEFAULT_CONSOLE_PROFILE as P } from "@/export/profile";
import { applyImportChanges, channelNotes, diffSnapshot, matchSource, showFromSnapshot } from "@/export/importShow";

const lib = createDefaultLibrary();
const DIR = process.env.DM7_SAMPLES ?? join(homedir(), "Documents/vender/dm7");
const BASIC = join(DIR, "basic.dm7f.dmxf");
const REAL = [join(DIR, "IndieMusicDay_0919_DM7C_MON.dm7f"), join(homedir(), "Downloads/IndieMusicDay_0919_DM7C_MON.dm7f")].find(existsSync);
const load = (p: string) => parseDm7File(new Uint8Array(readFileSync(p)));

/** 콘솔로 가는 내용만 (박스는 순서로 비교) */
function project(show: Show) {
  const port = (p: PortRef | null | undefined) =>
    !p ? null : p.kind === "stagebox" ? `box${show.stageBoxes.findIndex((b) => b.id === p.stageBoxId)}:${p.port}` : p.kind === "local" ? `local:${p.port}` : null;
  const fit = (s: string) => [...s.trim()].slice(0, P.nameMax).join("").trimEnd();
  const nums = (ids: string[], list: { id: string; number: number }[]) => ids.map((id) => list.find((x) => x.id === id)!.number).sort((a, b) => a - b);
  return {
    channels: show.inputs.map((c) => ({
      n: c.number,
      name: fit(c.shortName || c.source),
      color: consoleColor(P, c.color)?.value ?? null,
      port: port(c.port),
      phantom: c.port ? resolvePhantom(show, c) : null,
      pair: c.stereoLinkNext,
      dca: nums(c.dcaIds, show.dcas),
      mute: nums(c.muteGroupIds, show.muteGroups),
    })),
    buses: allocateBuses(show, () => {}, P).map((a) => ({
      label: a.label,
      name: fit(a.bus.name),
      width: a.bus.width,
      ports: (a.bus.width === "stereo" ? a.bus.ports.slice(0, 2) : a.bus.ports).map(port).filter(Boolean),
    })),
    dcas: show.dcas.map((d) => [d.number, d.name]),
    mutes: show.muteGroups.map((g) => [g.number, g.name]),
  };
}

function exported(show: Show, opts: Dm7Options): Dm7File {
  const plan = planDm7(show, load(BASIC), opts, { sources: lib.sources });
  return parseDm7File(buildDm7File(applyDm7(load(BASIC), plan)));
}

describe("소스 목록 찾기", () => {
  it("콘솔 이름으로 소스명·악기군", () => {
    const m = (n: string) => {
      const r = matchSource(n, lib.sources, lib.groups);
      return r && `${r.source}/${r.groupName}`;
    };
    expect(m("KICK IN")).toBe("Kick In/드럼");
    expect(m("OH L")).toBe("OH L/드럼");
    expect(m("Gaya2")).toBe("가야금 2/국악 현악");
    expect(m("TOM 1")).toBe("Tom 1/드럼");
    expect(m("BASS DI")).toBe("Bass DI/베이스");
    expect(m("RF VOX1")).toBeNull();
  });
});

describe.skipIf(!existsSync(BASIC))("DM7 쇼 파일 읽기 (샘플 필요)", () => {
  it("왕복: OnePatch가 내보낸 파일을 다시 읽으면 원래 Show와 같은 내용", () => {
    const show = createSampleShow();
    const opts = { ...defaultDm7Options(show), clearUnusedOutputs: true };
    const snap = readDm7(exported(show, opts), show.stageBoxes, opts.boxes);
    const base = { ...createEmptyShow("가져옴"), stageBoxes: show.stageBoxes };
    const { show: back, matches } = showFromSnapshot(snap, base, { skipDefault: true, sources: lib.sources, groups: lib.groups });
    expect(ShowSchema.safeParse(back).success).toBe(true);
    expect(project(back)).toEqual(project(show));
    // 파일에 없는 정보는 비움
    expect(back.inputs.every((c) => c.mic === null && c.stand === null && c.notes === "")).toBe(true);
    expect(matches.get(1)?.groupName).toBe("드럼");
    // 같은 Show와 비교하면 달라진 것이 없다
    expect(diffSnapshot(show, snap)).toEqual([]);
  });

  it("기본 이름 채널: 건너뛰기 / 모두 가져오기", () => {
    const show = createEmptyShow();
    const opts = defaultDm7Options(show);
    const snap = readDm7(load(BASIC), show.stageBoxes, opts.boxes);
    expect(showFromSnapshot(snap, show, { skipDefault: true }).show.inputs).toHaveLength(0);
    const all = showFromSnapshot(snap, show, { skipDefault: false }).show;
    expect(all.inputs).toHaveLength(72);
    expect(all.inputs[16]).toMatchObject({ shortName: "ch17", port: { kind: "stagebox", stageBoxId: show.stageBoxes[0].id, port: 1 } });
  });

  it("콘솔 변경분: 콘솔에서 고친 것만 잡고, 고르면 반영한다 (마이크·스탠드·비고는 그대로)", () => {
    const show = createSampleShow();
    const opts = { ...defaultDm7Options(show), clearUnusedOutputs: true };
    const file = exported(show, opts);
    // 콘솔에서 고친 것처럼: Ch1 이름, Ch2 컬러, Ch3 DCA 2 추가, Mix 1 이름, DCA 6 새 이름
    const cur = blockData(findBlock(file, "CurrentBackupFile.bup")!).slice();
    const mx = section(parseSections(cur), "Mixing");
    writeString(cur, locate(mx, [["InputChannel", 0], "Label", "Name"]), "KICK");
    writeString(cur, locate(mx, [["InputChannel", 1], "Label", "Color"]), "Green");
    writeBit(cur, locate(mx, [["InputChannel", 2], "DCA", "Assign"]), 1, true);
    writeString(cur, locate(mx, [["Mix", 0], "Label", "Name"]), "VOCAL");
    writeString(cur, locate(mx, [["DCA", 5], "Label", "Name"]), "FX");
    const edited: Dm7File = { ...file, blocks: file.blocks.map((b) => (b.name === "CurrentBackupFile.bup" ? { ...b, replaced: cur } : b)) };
    const snap = readDm7(edited, show.stageBoxes, opts.boxes);
    const changes = diffSnapshot(show, snap);
    expect(changes.map((c) => `${c.target} ${c.field}: ${c.before} → ${c.after}`)).toEqual([
      "Ch 1 이름: Kick In → KICK",
      "Ch 2 컬러: 빨강 → 초록",
      "Ch 3 DCA: 1 → 1, 2",
      "Mix 1 Vo Wedge 이름: Vo Wedge → VOCAL",
      "DCA 6 이름: — → FX",
    ]);
    // Ch 2 컬러만 빼고 반영
    const next = applyImportChanges(show, changes.filter((c) => c.field !== "컬러"), snap);
    expect(next.inputs[0].shortName).toBe("KICK");
    expect(next.inputs[1].color).toBe(show.inputs[1].color);
    expect(next.inputs[2].dcaIds.map((id) => next.dcas.find((d) => d.id === id)?.number)).toEqual([1, 2]);
    expect(next.outputs.find((b) => b.kind === "aux" && b.number === 1)?.name).toBe("VOCAL");
    expect(next.dcas.find((d) => d.number === 6)?.name).toBe("FX");
    next.inputs.forEach((c, i) => expect([c.mic, c.stand, c.notes, c.performer, c.source]).toEqual([show.inputs[i].mic, show.inputs[i].stand, show.inputs[i].notes, show.inputs[i].performer, show.inputs[i].source]));
    expect(checkShow(next).errors).toEqual([]);
    expect(diffSnapshot(next, snap).map((c) => c.field)).toEqual(["컬러"]);
  });
});

describe.skipIf(!REAL)("실제 공연 파일 (IndieMusicDay MON, DM Editor 1.x)", () => {
  it("Show가 만들어진다: 채널·스테레오 Mix·소스 목록", () => {
    const base = createEmptyShow("IndieMusicDay MON");
    const opts = defaultDm7Options(base);
    const snap = readDm7(load(REAL!), base.stageBoxes, opts.boxes);
    const { show, matches } = showFromSnapshot(snap, base, { skipDefault: true, sources: lib.sources, groups: lib.groups });
    expect(ShowSchema.safeParse(show).success).toBe(true);
    expect(checkShow(show).errors).toEqual([]);
    expect(show.inputs).toHaveLength(36);
    // 건너뛴 기본 채널(49–72)의 모르는 소스는 안내하지 않고, 모두 가져오면 한 줄로 묶는다
    expect(channelNotes(snap.channels.filter((c) => !c.isDefault))).toEqual([]);
    expect(channelNotes(snap.channels)).toEqual([expect.stringMatching(/^Ch 49, 50, .*72: OnePatch가 모르는 패치 소스/)]);
    expect(show.inputs[0]).toMatchObject({ number: 1, shortName: "KICK IN", source: "Kick In", color: "red" });
    expect(show.inputs[26]).toMatchObject({ number: 27, shortName: "RF VOX1", source: "RF VOX1", color: "yellow", port: { kind: "stagebox", port: 11 } });
    expect(matches.get(9)?.groupName).toBe("드럼");
    const aux = show.outputs.filter((b) => b.kind === "aux").map((b) => `${b.name}${b.width === "stereo" ? "(S)" : ""}`);
    expect(aux).toEqual(["VOX WDG", "DRUM WDG", "IEM1(S)", "IEM2(S)", "IEM3(S)", "IEM4(S)", "IEM5(S)", "IEM6(S)"]);
    expect(show.outputs.find((b) => b.name === "IEM1")?.ports).toEqual([
      { kind: "stagebox", stageBoxId: base.stageBoxes[0].id, port: 3 },
      { kind: "stagebox", stageBoxId: base.stageBoxes[0].id, port: 4 },
    ]);
  });
});
