/**
 * 크루 공유 API.
 * GET  /api/share?id=…            → 공유 내용 (로그인 없음, 읽기 전용, 캐시 안 함)
 * POST /api/share {payload}        → 새 공유: { id, key }
 * POST /api/share {id, key, payload} → 업데이트 (키가 맞아야)
 * POST /api/share {id, key, stop: true} → 공유 중지(삭제)
 */
import { z } from "zod";
import { SHARE_MAX_BYTES, SharePayloadSchema } from "@/model/share";
import { hashKey, ID_RE, keyMatches, newShareId, newShareKey, shareBackend } from "@/server/shareStore";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const NOT_CONNECTED = { error: "공유 저장소가 연결되지 않았습니다. Vercel 프로젝트에 Blob 저장소를 연결하세요 (README 참고)." };

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID_RE.test(id)) return json({ error: "잘못된 공유 링크입니다." }, 400);
  const store = shareBackend();
  if (!store) return json(NOT_CONNECTED, 503);
  const rec = await store.read(id);
  if (!rec) return json({ error: "공유가 없거나 중지되었습니다." }, 404);
  return json(rec.payload);
}

const Body = z.object({
  id: z.string().regex(ID_RE).optional(),
  key: z.string().min(20).max(200).optional(),
  payload: SharePayloadSchema.optional(),
  stop: z.boolean().optional(),
});

export async function POST(request: Request) {
  const store = shareBackend();
  if (!store) return json(NOT_CONNECTED, 503);
  const text = await request.text();
  if (text.length > SHARE_MAX_BYTES) return json({ error: "공유 내용이 너무 큽니다." }, 413);
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(JSON.parse(text));
  } catch {
    return json({ error: "형식이 맞지 않습니다." }, 400);
  }

  if (!body.id) {
    if (!body.payload) return json({ error: "공유 내용이 없습니다." }, 400);
    const id = newShareId();
    const key = newShareKey();
    await store.write(id, { keyHash: hashKey(key), payload: body.payload });
    return json({ id, key });
  }

  const rec = await store.read(body.id);
  if (!rec) return json({ error: "공유가 없거나 중지되었습니다." }, 404);
  if (!body.key || !keyMatches(body.key, rec.keyHash)) return json({ error: "이 공유를 바꿀 권한이 없습니다." }, 403);
  if (body.stop) {
    await store.remove(body.id);
    return json({ stopped: true });
  }
  if (!body.payload) return json({ error: "공유 내용이 없습니다." }, 400);
  await store.write(body.id, { keyHash: rec.keyHash, payload: body.payload });
  return json({ id: body.id });
}
