import { describe, expect, it } from "vitest";
import { createEmptyShow } from "@/model/factory";
import { ShowSchema } from "@/model/schema";
import { applyShowInfo, isIsoDate, showDocumentTitle, showInfoProblems, showInfoOf } from "@/model/showInfo";
import { showFileName } from "@/model/serialize";
import { fileBase } from "@/lib/showExport";
import { dm7FileName } from "@/export/dm7/fileName";

describe("공연 정보 편집", () => {
  it("공연명·날짜·장소 등을 바꾸고 스키마를 통과한다", () => {
    const show = createEmptyShow();
    const next = applyShowInfo(show, { title: "  여름 콘서트 ", date: "2026-07-04", venue: "세종문화회관", author: "정", version: "v2", notes: "리허설 14시\n" });
    expect(showInfoOf(next)).toEqual({ title: "여름 콘서트", date: "2026-07-04", venue: "세종문화회관", author: "정", version: "v2", notes: "리허설 14시" });
    expect(ShowSchema.safeParse(next).success).toBe(true);
  });

  it("빈 공연명, 잘못된 날짜는 받지 않고 같은 객체를 돌려준다", () => {
    const show = createEmptyShow();
    expect(applyShowInfo(show, { title: "   " })).toBe(show);
    expect(applyShowInfo(show, { date: "2026-02-30" })).toBe(show);
    expect(applyShowInfo(show, { date: "2026/07/04" })).toBe(show);
    expect(showInfoProblems({ ...showInfoOf(show), title: "" }).map((p) => p.field)).toEqual(["title"]);
  });

  it("날짜는 YYYY-MM-DD 또는 빈 값", () => {
    expect(isIsoDate("2026-11-19")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    const show = applyShowInfo(createEmptyShow(), { date: "2026-11-19" });
    expect(applyShowInfo(show, { date: "" }).date).toBe("");
  });

  it("바뀐 것이 없으면 같은 객체 (실행 취소 기록을 남기지 않음)", () => {
    const show = createEmptyShow("공연");
    expect(applyShowInfo(show, { title: "공연 " })).toBe(show);
  });

  it("공연명이 탭 제목·JSON·인쇄/엑셀·DM7 파일 이름에 들어간다", () => {
    const show = applyShowInfo(createEmptyShow(), { title: "여름 콘서트", date: "2026-07-04", version: "v2" });
    expect(showDocumentTitle(show)).toBe("여름 콘서트 — OnePatch");
    expect(showFileName(show)).toBe("2026-07-04_여름 콘서트_v2.json");
    expect(fileBase(show, "인풋 리스트")).toBe("2026-07-04_여름 콘서트_인풋 리스트_v2");
    expect(dm7FileName(show, "basic.dmxf")).toBe("2026-07-04_여름 콘서트_DM7_v2.dmxf");
    expect(dm7FileName(show, "show.dm7f.dmxf")).toBe("2026-07-04_여름 콘서트_DM7_v2.dmxf");
    expect(dm7FileName(show, "old.dm7f")).toBe("2026-07-04_여름 콘서트_DM7_v2.dm7f");
  });
});
