import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createEmptyShow, duplicateShow } from "@/model/factory";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { makeShowTemplate } from "@/model/templates";
import { backupStatus, backupToJson, markOf, parseBackup, restoreData, type AppData } from "@/model/backup";
import { readAppData, writeAppData } from "@/storage/backupStore";

function sampleData(): AppData {
  const a = createSampleShow();
  const b = { ...createEmptyShow("두 번째 공연"), updatedAt: "2026-11-19T01:00:00.000Z" };
  const lib = createDefaultLibrary();
  lib.showTemplates.push(makeShowTemplate("밴드 틀", a));
  lib.microphones.push({ id: "mic-my", model: "My Mic", type: "dynamic", needsPhantom: false, defaultStand: "", owned: 2, builtin: false });
  return { shows: [a, b], library: lib, consoleFiles: [{ key: "dm7", name: "basic.dmxf", uploadedAt: "2026-11-19T00:00:00.000Z", bytes: new Uint8Array([1, 2, 3, 250, 0, 9]) }] };
}

describe("전체 백업", () => {
  it("파일로 내보내고 다시 읽으면 Show·라이브러리·템플릿·기준 파일이 똑같다", () => {
    const data = sampleData();
    const r = parseBackup(backupToJson(data));
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.skipped).toEqual([]);
    expect(r.data.shows).toEqual(data.shows);
    expect(r.data.library).toEqual(data.library);
    expect(r.data.consoleFiles).toEqual(data.consoleFiles);
  });

  it("다른 브라우저(빈 저장소)에 가져오면 똑같이 보인다", async () => {
    const data = sampleData();
    await writeAppData(data);
    const json = backupToJson(await readAppData());
    // 다른 브라우저: 아무것도 없는 상태
    await writeAppData({ shows: [], library: createDefaultLibrary(), consoleFiles: [] });
    const r = parseBackup(json);
    if (!r.ok) throw new Error(r.errors.join());
    const { data: restored } = restoreData(await readAppData(), r.data, "replace");
    await writeAppData(restored);
    const now = await readAppData();
    const byId = (x: AppData["shows"]) => [...x].sort((p, q) => p.id.localeCompare(q.id));
    expect(byId(now.shows)).toEqual(byId(data.shows));
    expect(now.library).toEqual(data.library);
    expect(now.consoleFiles).toEqual(data.consoleFiles);
  });

  it("합치기: 없는 Show만 더하고, 같은 Show는 더 최근 것, 라이브러리는 새 항목만", () => {
    const backup = sampleData();
    const cur = sampleData();
    cur.shows = [{ ...backup.shows[0], title: "더 최근에 고친 것", updatedAt: "2099-01-01T00:00:00.000Z" }, duplicateShow(backup.shows[0])];
    cur.library = createDefaultLibrary();
    cur.consoleFiles = [];
    const { data, report } = restoreData(cur, backup, "merge");
    expect(report).toMatchObject({ showsAdded: 1, showsUpdated: 0, showsKept: 1, libraryItemsAdded: 2, consoleFiles: 1 });
    expect(data.shows.find((s) => s.id === backup.shows[0].id)?.title).toBe("더 최근에 고친 것");
    expect(data.shows).toHaveLength(3);
    expect(data.library?.showTemplates.map((t) => t.name)).toEqual(["밴드 틀"]);
    expect(data.library?.microphones.some((m) => m.id === "mic-my")).toBe(true);
  });

  it("덮어쓰기: 백업에 없는 Show는 지운다", () => {
    const backup = sampleData();
    const cur = { ...sampleData(), shows: [createEmptyShow("지워질 공연")] };
    const { data, report } = restoreData(cur, backup, "replace");
    expect(data.shows.map((s) => s.title)).toEqual(backup.shows.map((s) => s.title));
    expect(report.showsRemoved).toBe(1);
  });

  it("다른 파일은 거절한다", () => {
    expect(parseBackup("{}")).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify(createSampleShow()))).toEqual({ ok: false, errors: [expect.stringContaining("JSON 가져오기")] });
    expect(parseBackup("not json")).toMatchObject({ ok: false });
  });
});

describe("백업 알림", () => {
  it("백업 뒤 바뀐 Show·지운 Show·라이브러리 변경을 센다", () => {
    const data = sampleData();
    const mark = markOf(data);
    expect(backupStatus(mark, markOf(data)).due).toBe(false);
    const changed = { ...data, shows: [{ ...data.shows[0], updatedAt: "2099-01-01T00:00:00.000Z" }] };
    expect(backupStatus(mark, markOf(changed))).toMatchObject({ changedShows: 1, removedShows: 1, libraryChanged: false, due: true });
    const lib = { ...data, library: { ...data.library!, blockTemplates: [] } };
    lib.library!.showTemplates = [];
    expect(backupStatus(mark, markOf(lib)).libraryChanged).toBe(true);
    expect(backupStatus(null, markOf(data))).toMatchObject({ never: true, due: true });
    expect(backupStatus(null, markOf({ shows: [], library: null, consoleFiles: [] })).due).toBe(false);
  });
});
