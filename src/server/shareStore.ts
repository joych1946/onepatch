/**
 * 크루 공유 저장소 (서버 전용).
 * - Vercel Blob이 연결되어 있으면(BLOB_READ_WRITE_TOKEN 또는 BLOB_STORE_ID) 비공개 blob `shares/<id>.json`
 * - 개발·시험용: ONEPATCH_SHARE_DIR 폴더에 파일로
 * - 둘 다 없으면 "연결 안 됨"
 * 레코드 = { keyHash, payload }. 업데이트 키는 해시만 둔다(원래 키는 감독님 브라우저와 전체 백업에만).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { del, get, put } from "@vercel/blob";
import type { SharePayload } from "@/model/share";

export interface ShareRecord {
  keyHash: string;
  payload: SharePayload;
}

interface Backend {
  read(id: string): Promise<ShareRecord | null>;
  write(id: string, rec: ShareRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Blob 저장소는 만들 때 공개(public)·비공개(private)를 고른다. 비공개로 먼저 쓰고, 저장소가 공개라서 거절되면 공개로 바꿔 기억한다.
 * (ONEPATCH_BLOB_ACCESS=public|private로 정할 수도 있다.) 공개여도 경로에 추측할 수 없는 공유 id가 들어가므로 링크를 아는 사람만 본다.
 */
type Access = "private" | "public";
let access: Access = process.env.ONEPATCH_BLOB_ACCESS === "public" ? "public" : "private";
const accessProblem = (e: unknown) => /public|private|access/i.test(e instanceof Error ? e.message : String(e)) && !/token/i.test(String(e));
async function withAccess<T>(fn: (a: Access) => Promise<T>): Promise<T> {
  try {
    return await fn(access);
  } catch (e) {
    if (process.env.ONEPATCH_BLOB_ACCESS || !accessProblem(e)) throw e;
    const other: Access = access === "private" ? "public" : "private";
    const r = await fn(other);
    access = other;
    return r;
  }
}

const blobBackend: Backend = {
  async read(id) {
    const r = await withAccess((a) => get(`shares/${id}.json`, { access: a, useCache: false }));
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text()) as ShareRecord;
  },
  async write(id, rec) {
    await withAccess((a) =>
      put(`shares/${id}.json`, JSON.stringify(rec), {
        access: a,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      }),
    );
  },
  async remove(id) {
    await del(`shares/${id}.json`);
  },
};

function fileBackend(dir: string): Backend {
  const path = (id: string) => join(dir, `${id}.json`);
  return {
    async read(id) {
      try {
        return JSON.parse(await readFile(path(id), "utf8")) as ShareRecord;
      } catch {
        return null;
      }
    },
    async write(id, rec) {
      await mkdir(dir, { recursive: true });
      await writeFile(path(id), JSON.stringify(rec));
    },
    async remove(id) {
      await rm(path(id), { force: true });
    },
  };
}

export function shareBackend(): Backend | null {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return blobBackend;
  if (process.env.ONEPATCH_SHARE_DIR) return fileBackend(process.env.ONEPATCH_SHARE_DIR);
  return null;
}

/** 공유 id: 추측할 수 없게 (16바이트 → 22자) */
export const newShareId = () => randomBytes(16).toString("base64url");
export const newShareKey = () => randomBytes(32).toString("base64url");
export const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
export function keyMatches(key: string, hash: string): boolean {
  const a = Buffer.from(hashKey(key), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
