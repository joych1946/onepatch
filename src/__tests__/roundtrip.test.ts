import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { createEmptyShow, duplicateShow } from "@/model/factory";
import { parseShowJson, showToJson } from "@/model/serialize";
import { deleteShow, getShow, listShows, putShow } from "@/storage/showStore";

describe("샘플 Show", () => {
  it("스키마와 참조 무결성 검증을 통과한다", () => {
    const r = parseShowJson(showToJson(createSampleShow()));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("JSON 내보내기 → 가져오기 후 내용이 똑같다", () => {
    const show = createSampleShow();
    const json = showToJson(show);
    const r = parseShowJson(json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.show).toEqual(show);
    expect(showToJson(r.show)).toBe(json); // 바이트 단위로도 동일
  });

  it("IndexedDB 저장 → 내보내기 → 삭제 → 가져오기 후에도 똑같다", async () => {
    const show = createSampleShow();
    await putShow(show);
    const json = showToJson((await getShow(show.id))!);
    await deleteShow(show.id);
    expect(await getShow(show.id)).toBeNull();

    const r = parseShowJson(json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    await putShow(r.show);
    expect(await getShow(show.id)).toEqual(show);
  });
});

describe("검증", () => {
  it("빈 Show와 복제본도 유효하다", () => {
    const s = createEmptyShow();
    expect(parseShowJson(showToJson(s)).ok).toBe(true);
    const d = duplicateShow(s);
    expect(d.id).not.toBe(s.id);
    expect(parseShowJson(showToJson(d)).ok).toBe(true);
  });

  it("깨진 참조와 중복 채널 번호를 잡아낸다", () => {
    const s = createSampleShow();
    s.inputs[0].mic = { kind: "library", microphoneId: "nope" };
    s.inputs[1].number = s.inputs[2].number;
    s.inputs[2].port = { kind: "stagebox", stageBoxId: "box-rio1608", port: 99 };
    s.inputs[3].dcaIds = ["dca-x"];
    const r = parseShowJson(showToJson(s));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join("\n");
      expect(all).toContain("없는 마이크");
      expect(all).toContain("채널 번호 중복");
      expect(all).toContain("포트 범위 초과");
      expect(all).toContain("없는 DCA");
    }
  });

  it("JSON이 아니거나 필드가 빠지면 거부한다", () => {
    expect(parseShowJson("{oops").ok).toBe(false);
    const s = JSON.parse(showToJson(createSampleShow()));
    delete s.inputs[0].shortName;
    expect(parseShowJson(JSON.stringify(s)).ok).toBe(false);
  });

  it("목록은 최근 수정순이다", async () => {
    const a = { ...createEmptyShow("A"), updatedAt: "2026-01-01T00:00:00.000Z" };
    const b = { ...createEmptyShow("B"), updatedAt: "2026-02-01T00:00:00.000Z" };
    await putShow(a);
    await putShow(b);
    const titles = (await listShows()).map((s) => s.title);
    expect(titles.indexOf("B")).toBeLessThan(titles.indexOf("A"));
  });
});
