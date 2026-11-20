/**
 * 3번 재현: 마이크가 이미 들어 있는 채널을 DI로 클릭해서 바꾸기.
 * 원인 — 편집을 시작하면 칸에 있던 모델명("Shure SM58")으로 후보를 걸러서
 * 다른 모델·DI가 목록에 없었고, 후보도 앞에서 8개뿐이라 뒤쪽의 DI는 나오지 않았다.
 */
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { COLUMNS, COL_INDEX } from "@/model/inputColumns";
import { filterSuggestions } from "@/model/sheet";
import { micName } from "@/model/derive";

const lib = createDefaultLibrary();
const ctx = { catalog: lib.microphones };
const micCol = COLUMNS[COL_INDEX.mic];

describe("마이크/DI 칸 후보 (3번)", () => {
  const show = createSampleShow();
  const row = show.inputs.findIndex((c) => c.mic?.kind === "library");
  const ch = show.inputs[row];
  const start = micCol.editText(show, ch);
  const all = micCol.suggestions!(show, ctx);
  const keys = micCol.suggestionKeys?.(show, ctx);
  const diModels = lib.microphones.filter((m) => m.type === "di").map((m) => m.model);

  it("편집을 막 시작한 칸(원래 모델명 그대로)에서도 DI를 고를 수 있다", () => {
    expect(start).not.toBe("");
    const list = filterSuggestions(all, start, start, keys);
    for (const m of diModels) expect(list).toContain(m);
  });

  it("\"DI\"라고 치면 이름에 DI가 없는 DI(BSS AR-133 등)도 나온다", () => {
    const list = filterSuggestions(all, "DI", start, keys);
    for (const m of diModels) expect(list).toContain(m);
    expect(list.some((m) => m === "Shure SM58")).toBe(false);
  });

  it("후보를 고르면 마이크 → DI로 바뀌고, 지우면 비워진다", () => {
    const di = diModels[0];
    const s1 = micCol.set(show, row, di, ctx)!;
    expect(micName(s1, s1.inputs[row])).toBe(di);
    const s2 = micCol.set(s1, row, "", ctx)!;
    expect(s2.inputs[row].mic).toBeNull();
  });
});

import { createEmptyShow } from "@/model/factory";
import { BUILTIN_BLOCKS, insertBlock, resolveBuiltin } from "@/model/templates";
import { applyMicPick } from "@/model/pickFlow";
import { showFromSnapshot } from "@/export/importShow";
import { DEFAULT_CONSOLE_PROFILE } from "@/export/profile";
import { parseShow } from "@/model/serialize";
import type { Show } from "@/model/schema";

/** 마이크 지정 → DI로 바꾸기 → 지우기를 그리드 칸 입력으로 해 보고, 저장 검증까지 통과하는지 */
function cycle(show: Show, row: number) {
  const di = lib.microphones.find((m) => m.type === "di")!;
  const s1 = micCol.set(show, row, "Shure SM58", ctx)!;
  expect(micName(s1, s1.inputs[row])).toBe("Shure SM58");
  const s2 = micCol.set(s1, row, di.model, ctx)!;
  expect(micName(s2, s2.inputs[row])).toBe(di.model);
  const s3 = micCol.set(s2, row, "", ctx)!;
  expect(s3.inputs[row].mic).toBeNull();
  for (const s of [s1, s2, s3]) expect(parseShow(s).ok).toBe(true);
}

describe("마이크/DI 지정·바꾸기·지우기 — 경로별 (3번)", () => {
  it("그리드에 직접 입력한 채널", () => cycle(createSampleShow(), 0));

  it("누르기 입력으로 넣은 채널 (마이크 → DI)", () => {
    const show = createSampleShow();
    const di = lib.microphones.find((m) => m.type === "di")!;
    const s = applyMicPick(show, [0], { kind: "library", mic: di });
    expect(micName(s, s.inputs[0])).toBe(di.model);
    cycle(s, 0);
  });

  it("여러 행 일괄 변경 (선택한 행 모두 DI로, 모두 비우기)", () => {
    const show = createSampleShow();
    const di = lib.microphones.find((m) => m.type === "di")!;
    const rows = [0, 1, 2];
    const s = rows.reduce((x, r) => micCol.set(x, r, di.model, ctx)!, show);
    rows.forEach((r) => expect(micName(s, s.inputs[r])).toBe(di.model));
    const cleared = rows.reduce((x, r) => micCol.set(x, r, "", ctx)!, s);
    rows.forEach((r) => expect(cleared.inputs[r].mic).toBeNull());
  });

  it("템플릿으로 넣은 채널", () => {
    const e = createEmptyShow();
    const blk = BUILTIN_BLOCKS[0];
    const s = insertBlock(e, lib, resolveBuiltin(blk, lib, e), 0, true).show;
    cycle(s, 0);
  });

  it("DM7 파일에서 읽어 온 채널 (마이크 정보가 없는 Show)", () => {
    const base = createEmptyShow();
    const snap = {
      modelName: "DM7",
      profile: DEFAULT_CONSOLE_PROFILE,
      channels: [{ number: 1, name: "Vox", color: "none", port: null, portLabel: "없음", phantom: false, pairNext: false, dca: [], mute: [], isDefault: false }],
      buses: [],
      dcas: [],
      mutes: [],
      notes: [],
    } as unknown as Parameters<typeof showFromSnapshot>[0];
    const s = showFromSnapshot(snap, base, { skipDefault: false }).show;
    expect(s.microphones).toEqual([]);
    cycle(s, 0);
  });
});
