/**
 * 전체 백업: 모든 Show + 내 라이브러리(내 템플릿 포함) + 콘솔 기준 파일을 JSON 파일 하나로.
 * 가져올 때 "덮어쓰기"(지금 데이터를 백업 내용으로 바꿈)와 "합치기"(없는 것만 더하고 같은 Show는 더 최근 것)를 고른다.
 * 저장소 읽기/쓰기는 src/storage/backupStore.ts, 이 파일은 순수 계산만.
 */
import { z } from "zod";
import { parseShow } from "./serialize";
import { LibrarySchema, type Library } from "./library";
import { upgradeLibrary } from "./libraryDefaults";
import type { Show } from "./schema";
import type { VersionMeta } from "./versions";

export const BACKUP_FORMAT = "onepatch-backup";
export const BACKUP_VERSION = 1;

export interface ConsoleFileData {
  key: string;
  name: string;
  uploadedAt: string;
  bytes: Uint8Array;
}

export interface VersionData {
  meta: VersionMeta;
  show: Show;
}

/** 앱의 모든 데이터 */
export interface AppData {
  shows: Show[];
  library: Library | null;
  consoleFiles: ConsoleFileData[];
  /** Show 버전 (11단계) */
  versions?: VersionData[];
}

export type RestoreMode = "replace" | "merge";

/* ───────────── 파일 ───────────── */

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function backupToJson(data: AppData, createdAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt,
      shows: data.shows,
      library: data.library,
      consoleFiles: data.consoleFiles.map((f) => ({ key: f.key, name: f.name, uploadedAt: f.uploadedAt, data: toBase64(f.bytes) })),
      versions: data.versions ?? [],
    },
    null,
    1,
  );
}

export function backupFileName(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `OnePatch_전체백업_${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}.json`;
}

const FileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  createdAt: z.string(),
  shows: z.array(z.unknown()),
  library: z.unknown().nullable(),
  consoleFiles: z.array(z.object({ key: z.string(), name: z.string(), uploadedAt: z.string(), data: z.string() })).default([]),
  versions: z
    .array(z.object({ meta: z.object({ id: z.string(), showId: z.string(), name: z.string(), createdAt: z.string(), inputs: z.number(), outputs: z.number(), fp: z.string() }), show: z.unknown() }))
    .default([]),
});

export type ParsedBackup =
  | { ok: true; data: AppData; createdAt: string; skipped: string[] }
  | { ok: false; errors: string[] };

/** 백업 파일 읽기. 손상된 Show는 건너뛰고 알려준다. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON 형식이 아닙니다."] };
  }
  const f = FileSchema.safeParse(raw);
  if (!f.success) {
    const single = parseShow(raw);
    return { ok: false, errors: [single.ok ? "Show 하나짜리 파일입니다. 목록의 “JSON 가져오기”로 가져오세요." : "OnePatch 전체 백업 파일이 아닙니다."] };
  }
  if (f.data.version > BACKUP_VERSION) return { ok: false, errors: [`더 새 버전(v${f.data.version})의 백업입니다. 앱을 새로고침해 최신 버전으로 가져오세요.`] };
  const skipped: string[] = [];
  const shows: Show[] = [];
  f.data.shows.forEach((s, i) => {
    const r = parseShow(s);
    if (r.ok) shows.push(r.show);
    else skipped.push(`Show ${i + 1}: ${r.errors[0]}`);
  });
  let library: Library | null = null;
  if (f.data.library !== null) {
    const l = LibrarySchema.safeParse(f.data.library);
    if (l.success) library = upgradeLibrary(l.data);
    else skipped.push(`내 라이브러리: ${l.error.issues[0]?.message ?? "형식 오류"}`);
  }
  const consoleFiles: ConsoleFileData[] = [];
  for (const c of f.data.consoleFiles) {
    try {
      consoleFiles.push({ key: c.key, name: c.name, uploadedAt: c.uploadedAt, bytes: fromBase64(c.data) });
    } catch {
      skipped.push(`콘솔 기준 파일 ${c.name}: 읽을 수 없음`);
    }
  }
  const versions: VersionData[] = [];
  for (const v of f.data.versions) {
    const r = parseShow(v.show);
    if (r.ok) versions.push({ meta: v.meta, show: r.show });
    else skipped.push(`버전 ${v.meta.name}: ${r.errors[0]}`);
  }
  return { ok: true, data: { shows, library, consoleFiles, versions }, createdAt: f.data.createdAt, skipped };
}

/* ───────────── 가져오기 ───────────── */

export interface RestoreReport {
  showsAdded: number;
  showsUpdated: number;
  showsKept: number;
  showsRemoved: number;
  libraryItemsAdded: number;
  libraryReplaced: boolean;
  consoleFiles: number;
}

/** 같은 id는 지금 것을 두고, 없는 것만 뒤에 더한다 */
function unionById<T extends { id: string }>(cur: T[], inc: T[]): { list: T[]; added: number } {
  const ids = new Set(cur.map((x) => x.id));
  const extra = inc.filter((x) => !ids.has(x.id));
  return { list: [...cur, ...extra], added: extra.length };
}

export function restoreData(current: AppData, incoming: AppData, mode: RestoreMode): { data: AppData; report: RestoreReport } {
  if (mode === "replace") {
    const incIds = new Set(incoming.shows.map((s) => s.id));
    return {
      data: { shows: incoming.shows, library: incoming.library ?? current.library, consoleFiles: incoming.consoleFiles, versions: incoming.versions ?? [] },
      report: {
        showsAdded: incoming.shows.filter((s) => !current.shows.some((c) => c.id === s.id)).length,
        showsUpdated: incoming.shows.filter((s) => current.shows.some((c) => c.id === s.id)).length,
        showsKept: 0,
        showsRemoved: current.shows.filter((s) => !incIds.has(s.id)).length,
        libraryItemsAdded: 0,
        libraryReplaced: !!incoming.library,
        consoleFiles: incoming.consoleFiles.length,
      },
    };
  }
  // 합치기
  const byId = new Map(current.shows.map((s) => [s.id, s]));
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const s of incoming.shows) {
    const cur = byId.get(s.id);
    if (!cur) {
      byId.set(s.id, s);
      added++;
    } else if (s.updatedAt > cur.updatedAt) {
      byId.set(s.id, s);
      updated++;
    } else kept++;
  }
  let library = current.library;
  let libAdded = 0;
  if (incoming.library) {
    if (!library) {
      library = incoming.library;
    } else {
      const parts = (["microphones", "groups", "sources", "blockTemplates", "showTemplates"] as const).map((k) => {
        const u = unionById<{ id: string }>(library![k], incoming.library![k]);
        libAdded += u.added;
        return [k, u.list] as const;
      });
      library = { ...library, ...Object.fromEntries(parts) } as Library;
    }
  }
  const keys = new Set(current.consoleFiles.map((f) => f.key));
  const consoleFiles = [...current.consoleFiles, ...incoming.consoleFiles.filter((f) => !keys.has(f.key))];
  const vIds = new Set((current.versions ?? []).map((v) => v.meta.id));
  const versions = [...(current.versions ?? []), ...(incoming.versions ?? []).filter((v) => !vIds.has(v.meta.id))];
  return {
    data: { shows: [...byId.values()], library, consoleFiles, versions },
    report: {
      showsAdded: added,
      showsUpdated: updated,
      showsKept: kept,
      showsRemoved: 0,
      libraryItemsAdded: libAdded,
      libraryReplaced: false,
      consoleFiles: consoleFiles.length - current.consoleFiles.length,
    },
  };
}

/* ───────────── 백업 알림 ───────────── */

/** 마지막 백업 때의 상태 (브라우저 localStorage) */
export interface BackupMark {
  at: string;
  shows: Record<string, string>;
  library: string;
  consoleFiles: string;
  /** 버전 id 지문 (예전 표시에는 없음) */
  versions?: string;
}

/** 짧은 지문 (FNV-1a) — 바뀌었는지만 본다 */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function markOf(
  data: { shows: Pick<Show, "id" | "updatedAt">[]; library: Library | null; consoleFiles: Pick<ConsoleFileData, "key" | "uploadedAt">[]; versions?: { meta: Pick<VersionMeta, "id"> }[] },
  at = new Date().toISOString(),
): BackupMark {
  return {
    at,
    shows: Object.fromEntries(data.shows.map((s) => [s.id, s.updatedAt])),
    library: data.library ? fingerprint(JSON.stringify(data.library)) : "",
    consoleFiles: data.consoleFiles.map((f) => `${f.key}:${f.uploadedAt}`).sort().join(","),
    versions: fingerprint((data.versions ?? []).map((v) => v.meta.id).sort().join(",")),
  };
}

export interface BackupStatus {
  /** 한 번도 백업하지 않음 */
  never: boolean;
  at: string | null;
  changedShows: number;
  removedShows: number;
  libraryChanged: boolean;
  consoleChanged: boolean;
  versionsChanged?: boolean;
  /** 알릴 만큼 쌓였는지 */
  due: boolean;
}

export function backupStatus(mark: BackupMark | null, now: BackupMark): BackupStatus {
  if (!mark) {
    const any = Object.keys(now.shows).length > 0;
    return { never: true, at: null, changedShows: Object.keys(now.shows).length, removedShows: 0, libraryChanged: false, consoleChanged: false, due: any };
  }
  const changedShows = Object.entries(now.shows).filter(([id, at]) => mark.shows[id] !== at).length;
  const removedShows = Object.keys(mark.shows).filter((id) => !(id in now.shows)).length;
  const libraryChanged = mark.library !== now.library;
  const consoleChanged = mark.consoleFiles !== now.consoleFiles;
  const versionsChanged = mark.versions !== undefined && mark.versions !== now.versions;
  return { never: false, at: mark.at, changedShows, removedShows, libraryChanged, consoleChanged, versionsChanged, due: changedShows + removedShows > 0 || libraryChanged || consoleChanged || versionsChanged };
}
