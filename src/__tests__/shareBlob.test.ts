/** Blob 저장소가 공개(public)로 만들어진 경우: 비공개 저장이 거절되면 공개로 바꿔 계속한다 */
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const files = new Map<string, string>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (path: string, body: string, o: { access: string }) => {
    calls.push(`put:${o.access}`);
    if (o.access === "private") throw new Error("Vercel Blob: Cannot use private access on a public store");
    files.set(path, body);
    return { url: "x" };
  }),
  get: vi.fn(async (path: string, o: { access: string }) => {
    calls.push(`get:${o.access}`);
    // 실제 SDK: 비공개 주소로 공개 저장소를 읽으면 400
    if (o.access === "private") throw new Error("Vercel Blob: Failed to fetch blob: 400 Bad Request");
    const body = files.get(path);
    return body ? { statusCode: 200, stream: new Response(body).body } : null;
  }),
  del: vi.fn(async () => {}),
}));

describe("공유 저장소: 공개 Blob", () => {
  it("비공개가 거절되면 공개로 저장·읽기, 그다음부터는 바로 공개로", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    const { shareBackend } = await import("@/server/shareStore");
    const store = shareBackend()!;
    await store.write("abcdefghijklmnopqrstuv", { keyHash: "h", payload: { v: 1 } as never });
    expect(calls).toEqual(["put:private", "put:public"]);
    expect((await store.read("abcdefghijklmnopqrstuv"))?.keyHash).toBe("h");
    expect(calls.slice(2)).toEqual(["get:public"]);
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it("다른 서버 인스턴스(아직 비공개로 아는 상태)에서 읽어도 공개로 바꿔 읽는다", async () => {
    vi.resetModules();
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    const { shareBackend } = await import("@/server/shareStore");
    calls.length = 0;
    expect((await shareBackend()!.read("abcdefghijklmnopqrstuv"))?.keyHash).toBe("h");
    expect(calls).toEqual(["get:private", "get:public"]);
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it("다른 저장소 오류는 그대로 알린다 (API는 502와 메시지)", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    const blob = await import("@vercel/blob");
    vi.mocked(blob.put).mockRejectedValueOnce(new Error("Vercel Blob: This store has been suspended."));
    const { POST } = await import("@/app/api/share/route");
    const { buildSharePayload } = await import("@/model/share");
    const { createSampleShow } = await import("@/sample/fivePieceBand");
    const res = await POST(new Request("http://x/api/share", { method: "POST", body: JSON.stringify({ payload: buildSharePayload(createSampleShow(), null) }) }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("공유 저장소 오류: Vercel Blob: This store has been suspended.");
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
});
