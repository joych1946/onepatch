import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import type { Show } from "@/model/schema";
import { changedRowIds, contentFingerprint, currentVersion, defaultBase, diffShows, suggestVersionName } from "@/model/versions";
import { getShow, putShow } from "@/storage/showStore";
import { deleteVersion, getVersionShow, listVersions, saveVersion } from "@/storage/versionStore";
import { backupToJson, parseBackup } from "@/model/backup";
import { readAppData } from "@/storage/backupStore";

/** 리허설 후: 3채널을 바꾼다 (마이크 이름이 아니라 출력물에 보이는 칸으로) */
function afterRehearsal(v1: Show): Show {
  const inputs = v1.inputs.map((c) => {
    if (c.number === 3) return { ...c, shortName: "SN Top2", notes: "SM57 → i5" };
    if (c.number === 12) return { ...c, phantom: true };
    if (c.number === 22) return { ...c, color: "pink" as const };
    return c;
  });
  return { ...v1, inputs, updatedAt: new Date(Date.parse(v1.updatedAt) + 1000).toISOString() };
}

describe("버전 비교", () => {
  it("리허설 후 3채널을 바꾸면 그 3채널만 나온다", () => {
    const v1 = createSampleShow();
    const v2 = afterRehearsal(v1);
    const d = diffShows(v1, v2);
    expect(d.inputs.map((r) => `${r.kind} ${r.label}: ${r.fields.map((f) => `${f.field} ${f.before}→${f.after}`).join(", ")}`)).toEqual([
      "changed Ch 3 SN Top2: 짧은 이름 SN Top→SN Top2, 비고 →SM57 → i5",
      "changed Ch 12 Bass Mic: 48V →48V",
      "changed Ch 22 Gt Vo: 컬러 하늘→분홍",
    ]);
    // 이름·48V·컬러만 바뀌었으므로 패치(연결)는 그대로
    expect([d.patch, d.outputs, d.groups, d.info]).toEqual([[], [], [], []]);
    expect(d.total).toBe(3);
    expect([...changedRowIds(d)].map((id) => v2.inputs.find((c) => c.id === id)!.number)).toEqual([3, 12, 22]);
  });

  it("추가·삭제·번호 변경, 아웃풋·DCA", () => {
    const v1 = createSampleShow();
    const v2: Show = {
      ...v1,
      inputs: [...v1.inputs.filter((c) => c.number !== 26), { ...v1.inputs[25], id: "new-ch", number: 27, source: "Guest Vo", shortName: "Guest" }],
      outputs: v1.outputs.map((b) => (b.kind === "aux" && b.number === 1 ? { ...b, name: "Vo Wdg" } : b)),
      dcas: v1.dcas.map((d) => (d.number === 5 ? { ...d, name: "Vocals" } : d)),
    };
    const d = diffShows(v1, v2);
    // DCA 5 이름이 바뀌어 그 DCA를 쓰는 Ch 21–25의 DCA 칸도 바뀐 것으로 나온다
    expect(d.inputs.map((r) => `${r.kind} ${r.label}`)).toEqual([
      "changed Ch 21 Lead Vo", "changed Ch 22 Gt Vo", "changed Ch 23 Keys Vo", "changed Ch 24 Bass Vo", "changed Ch 25 MC",
      "added Ch 27 Guest", "removed Ch 26 TB",
    ]);
    expect(d.inputs[0].fields).toEqual([{ field: "DCA", before: "5 Vox", after: "5 Vocals" }]);
    // 패치: Ch 26을 지우고 Ch 27을 그 포트에 → 포트 하나의 주인이 바뀜
    expect(d.patch.map((r) => `${r.label}: ${r.fields[0].before} → ${r.fields[0].after}`)).toEqual([expect.stringMatching(/: Ch 26 → Ch 27$/)]);
    expect(d.outputs.map((r) => `${r.kind} ${r.label} ${r.fields.map((f) => f.field)}`)).toEqual(["changed Aux 1 Vo Wdg 이름"]);
    expect(d.groups.map((r) => `${r.label}: ${r.fields.map((f) => `${f.before}→${f.after}`)}`)).toEqual(["DCA 5 Vocals: Vox→Vocals"]);
  });

  it("이름 제안, 비교 기준 고르기", () => {
    expect(suggestVersionName([])).toBe("v1 ");
    expect(suggestVersionName([{ name: "v2 리허설 후" }, { name: "v1 사전 배포" }])).toBe("v3 ");
    const a = { id: "a", fp: "1" } as never;
    const b = { id: "b", fp: "2" } as never;
    expect(defaultBase([b, a], "2")).toBe(a); // 지금 = 마지막 버전 → 그 앞 버전과 비교
    expect(defaultBase([b, a], "3")).toBe(b); // 저장 안 한 수정 → 마지막 버전과 비교
    expect(currentVersion([b, a], "2")).toBe(b);
  });
});

describe("버전 저장소", () => {
  it("저장·목록·되읽기, 버전 20개여도 Show 읽기는 버전을 읽지 않는다", async () => {
    const show = createSampleShow();
    await putShow(show);
    const v1 = await saveVersion(show, "v1 사전 배포", "2026-11-01T00:00:00.000Z");
    let cur = show;
    for (let i = 2; i <= 20; i++) {
      cur = { ...cur, inputs: cur.inputs.map((c, k) => (k === 0 ? { ...c, notes: `rev ${i}` } : c)) };
      await saveVersion(cur, `v${i}`, `2026-11-${String(i).padStart(2, "0")}T00:00:00.000Z`);
    }
    const list = await listVersions(show.id);
    expect(list).toHaveLength(20);
    expect(list[0].name).toBe("v20");
    expect(list.at(-1)!.fp).toBe(contentFingerprint(show));
    expect((await getVersionShow(v1.id)).inputs[0].notes).toBe(show.inputs[0].notes);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) await getShow(show.id);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
    // 백업에 버전도 들어간다
    const r = parseBackup(backupToJson(await readAppData()));
    expect(r.ok && r.data.versions?.filter((v) => v.meta.showId === show.id).length).toBe(20);
    await deleteVersion(v1.id);
    expect(await listVersions(show.id)).toHaveLength(19);
  });
});
