import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import type { Show } from "@/model/schema";
import { buildSharePayload, SharePayloadSchema, type SharePayload } from "@/model/share";
import { GET, POST } from "@/app/api/share/route";

function afterRehearsal(v1: Show): Show {
  return {
    ...v1,
    inputs: v1.inputs.map((c) =>
      c.number === 3 ? { ...c, shortName: "SN Top2" } : c.number === 12 ? { ...c, phantom: true } : c.number === 22 ? { ...c, color: "pink" as const } : c,
    ),
  };
}

describe("크루 공유 내용", () => {
  it("리허설 후 3채널을 바꾸고 다시 공유하면 그 3채널에 변경 표시", () => {
    const v1 = createSampleShow();
    const first = buildSharePayload(v1, null);
    expect(first.changeCount).toBe(0);
    expect(first.inputs.some((r) => r.changed || r.added)).toBe(false);
    const v2 = afterRehearsal(v1);
    const p = buildSharePayload(v2, { show: v1, label: "지난 공유", at: first.publishedAt });
    expect(SharePayloadSchema.safeParse(p).success).toBe(true);
    expect(p.changeCount).toBe(3);
    expect(p.inputs.filter((r) => r.changed).map((r) => [r.cells.ch, r.changed])).toEqual([
      [3, { shortName: "SN Top" }],
      [12, { phantom: "" }],
      [22, { color: "하늘" }],
    ]);
    expect(p.outputs.some((r) => r.changed)).toBe(false);
    // 편집 데이터(마이크 id 등)는 보내지 않는다: 사람이 읽는 값만
    expect(JSON.stringify(p)).not.toContain("microphoneId");
    expect(JSON.stringify(p).length).toBeLessThan(20_000);
  });
});

describe("공유 API (파일 저장소로 시험)", () => {
  const prev = process.env.ONEPATCH_SHARE_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.ONEPATCH_SHARE_DIR;
    else process.env.ONEPATCH_SHARE_DIR = prev;
  });
  const post = (body: unknown) => POST(new Request("http://x/api/share", { method: "POST", body: JSON.stringify(body) }));
  const get = (id: string) => GET(new Request(`http://x/api/share?id=${id}`));

  it("만들기 → 키 없이·틀린 키로 못 바꿈 → 업데이트 → 크루가 받음 → 중지", async () => {
    process.env.ONEPATCH_SHARE_DIR = mkdtempSync(join(tmpdir(), "onepatch-share-"));
    const v1 = createSampleShow();
    const p1 = buildSharePayload(v1, null);
    const created = await post({ payload: p1 });
    expect(created.status).toBe(200);
    const { id, key } = (await created.json()) as { id: string; key: string };
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await get(id)).headers.get("Cache-Control")).toBe("no-store");

    const p2 = buildSharePayload(afterRehearsal(v1), { show: v1, label: "지난 공유", at: p1.publishedAt });
    expect((await post({ id, payload: p2 })).status).toBe(403);
    expect((await post({ id, key: "x".repeat(43), payload: p2 })).status).toBe(403);
    expect((await post({ id, key, payload: p2 })).status).toBe(200);

    const crew = (await (await get(id)).json()) as SharePayload;
    expect(crew.changeCount).toBe(3);
    expect(crew.inputs.filter((r) => r.changed).map((r) => r.cells.ch)).toEqual([3, 12, 22]);

    expect((await post({ id, key, stop: true })).status).toBe(200);
    expect((await get(id)).status).toBe(404);
  });

  it("저장소가 없으면 503, 잘못된 id·형식은 400", async () => {
    delete process.env.ONEPATCH_SHARE_DIR;
    expect((await post({ payload: buildSharePayload(createSampleShow(), null) })).status).toBe(503);
    process.env.ONEPATCH_SHARE_DIR = mkdtempSync(join(tmpdir(), "onepatch-share-"));
    expect((await get("../etc")).status).toBe(400);
    expect((await post({ payload: { v: 1 } })).status).toBe(400);
  });
});
