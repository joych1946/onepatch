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
import { locate, parseSections, section } from "@/export/dm7/mbdf";
import { applyDm7, defaultDm7Options, planDm7, type Dm7Item } from "@/export/dm7/dm7Export";
import { createEmptyShow } from "@/model/factory";
import { newChannel } from "@/model/inputOps";
import type { Color, InputChannel, Show } from "@/model/schema";

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
  return { name: true, color: at("color"), icon: false, patch: at("patch"), phantom: at("48V_local"), pair: at("link"), dca: at("link"), mute: at("link") };
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
      const opts = { ...defaultDm7Options(show), items: itemsFor(stage) };
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
    const plan = planDm7(show, base, { ...defaultDm7Options(show), items: { ...itemsFor("48V_dante") } });
    const fields = plan.changes.map((c) => `${c.ch} ${c.field}: ${c.before} → ${c.after}`);
    expect(fields).toContain("1 이름: ch 1 → KickInsi");
    expect(fields).toContain("2 패치: OMNI 2 → Dante 2");
    expect(fields).toContain("3 페어: 단독 → 페어 L (3–4)");
    expect(fields).toContain("4 뮤트: — → 1");
    expect(fields).toContain("5 48V (OMNI 1): 꺼짐 → 켜짐");
    expect(plan.warnings.join("\n")).toMatch(/8자/);
    expect(plan.warnings.join("\n")).toMatch(/72채널/);
  });
});
