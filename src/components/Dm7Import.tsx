"use client";

/**
 * DM7 쇼 파일 읽기 화면.
 * - NewShowFromDm7: 목록 화면의 "DM7 파일에서 새 Show" (미리보기 → 만들기)
 * - ConsoleChanges: 콘솔 내보내기 화면의 "콘솔에서 고친 내용 가져오기" (달라진 것만 골라 반영)
 * 계산은 src/export/dm7/dm7Import.ts(읽기)와 src/export/importShow.ts(Show 만들기·비교).
 */
import { useMemo, useRef, useState } from "react";
import type { Show } from "@/model/schema";
import type { Library } from "@/model/library";
import { createEmptyShow } from "@/model/factory";
import { COLOR_LABEL, formatPort } from "@/model/labels";
import { parseDm7File, Dm7FormatError, type Dm7File } from "@/export/dm7/container";
import { defaultDm7Options, type Dm7Options } from "@/export/dm7/dm7Export";
import { readDm7, type ConsoleSnapshot } from "@/export/dm7/dm7Import";
import { dm7FileInfo } from "@/export/dm7/fileInfo";
import { applyImportChanges, channelNotes, diffSnapshot, showFromSnapshot, type ImportChange } from "@/export/importShow";

const btn = "rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";

async function readFile(f: File): Promise<Dm7File> {
  return parseDm7File(new Uint8Array(await f.arrayBuffer()));
}
const errText = (e: unknown) => (e instanceof Dm7FormatError ? e.message : `파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
const portText = (show: Show, p: Show["inputs"][number]["port"]) =>
  formatPort(p, show.stageBoxes);

/* ───────────── 새 Show ───────────── */

export function NewShowFromDm7({ library, onCreate, onClose }: { library: Library | null; onCreate: (show: Show) => void; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ name: string; file: Dm7File; base: Show; snap: ConsoleSnapshot } | null>(null);
  const [title, setTitle] = useState("");
  const [skipDefault, setSkipDefault] = useState(true);

  const onFile = async (f: File) => {
    setError(null);
    try {
      const file = await readFile(f);
      const name = f.name.replace(/(\.dm7f)?\.(dmxf|dm7f)$/i, "");
      const base = createEmptyShow(name);
      const snap = readDm7(file, base.stageBoxes, defaultDm7Options(base).boxes);
      setLoaded({ name: f.name, file, base, snap });
      setTitle(name);
    } catch (e) {
      setLoaded(null);
      setError(errText(e));
    }
  };

  const result = useMemo(
    () => (loaded ? showFromSnapshot(loaded.snap, { ...loaded.base, title: title.trim() || loaded.base.title }, { skipDefault, sources: library?.sources, groups: library?.groups }) : null),
    [loaded, title, skipDefault, library],
  );
  const info = loaded ? dm7FileInfo(loaded.file) : null;
  const show = result?.show;
  const skipped = loaded ? loaded.snap.channels.filter((c) => c.isDefault).length : 0;
  const notes = loaded ? [...channelNotes(loaded.snap.channels.filter((c) => !skipDefault || !c.isDefault)), ...loaded.snap.notes] : [];

  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="DM7 파일에서 새 Show" className="absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-2xl sm:inset-x-auto sm:top-8 sm:bottom-8 sm:left-1/2 sm:w-[880px] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900">
        <h2 className="font-semibold">DM7 쇼 파일에서 새 Show</h2>
        <p className="text-xs text-neutral-500">
          콘솔이나 DM Editor에서 저장한 .dmxf(.dm7f)의 인풋 이름·컬러·패치·48V·페어·DCA·뮤트, 아웃풋 패치, 버스·DCA·뮤트 이름을 읽습니다. 마이크·스탠드·비고는 비워 둡니다. 원본 파일은 바뀌지 않습니다.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".dmxf,.dm7f"
          aria-label="읽을 DM7 쇼 파일"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button className={`${btn} border-blue-500 font-medium text-blue-700 dark:text-blue-300`} onClick={() => fileRef.current?.click()}>
            {loaded ? "다른 파일…" : "파일 고르기…"}
          </button>
          {loaded && info && (
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {loaded.name} · {info.modelName} · {info.savedAt ? new Date(info.savedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "저장 시각 모름"}
            </span>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loaded && show && (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                공연명
                <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="새 Show 공연명" className="w-56 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={skipDefault} onChange={(e) => setSkipDefault(e.target.checked)} />
                기본 이름(ch 1, MX 1 …) 그대로인 빈 채널·버스 건너뛰기 <span className="text-xs text-neutral-500">({skipped}채널)</span>
              </label>
            </div>
            <p className="text-xs text-neutral-500">
              스테이지박스는 기본 구성으로 맞춥니다: {show.stageBoxes.map((b, i) => `${b.name} = Dante ${i === 0 ? 1 : 1 + show.stageBoxes.slice(0, i).reduce((n, x) => n + x.inputs, 0)}부터`).join(", ")}. 다르면 만든 뒤 패치 탭에서 고치세요.
            </p>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
              <table className="w-full border-collapse text-left text-xs" aria-label="가져올 채널">
                <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-900">
                  <tr>
                    {["Ch", "이름", "소스 (악기군)", "컬러", "패치", "48V", "페어", "DCA", "뮤트"].map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {show.inputs.map((c) => {
                    const m = result.matches.get(c.number);
                    const num = (ids: string[], list: { id: string; number: number }[]) => ids.map((id) => list.find((x) => x.id === id)?.number).join(", ");
                    return (
                      <tr key={c.id} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="px-2 py-1 tabular-nums">{c.number}</td>
                        <td className="px-2 py-1 font-mono">{c.shortName}</td>
                        <td className="px-2 py-1">{m ? `${m.source} (${m.groupName})` : <span className="text-neutral-400">목록에 없음</span>}</td>
                        <td className="px-2 py-1">{c.color === "none" ? "—" : COLOR_LABEL[c.color]}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{portText(show, c.port)}</td>
                        <td className="px-2 py-1">{c.phantom ? "48V" : ""}</td>
                        <td className="px-2 py-1">{c.stereoLinkNext ? `${c.number}/${c.number + 1}` : ""}</td>
                        <td className="px-2 py-1">{num(c.dcaIds, show.dcas)}</td>
                        <td className="px-2 py-1">{num(c.muteGroupIds, show.muteGroups)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              버스: {show.outputs.map((b) => `${b.name || "(이름 없음)"}${b.width === "stereo" ? "(S)" : ""}`).join(", ") || "없음"} · DCA {show.dcas.length} · 뮤트 그룹 {show.muteGroups.length}
            </p>
            {notes.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button className="min-h-10 px-4 text-neutral-500" onClick={onClose}>
            취소
          </button>
          <button
            disabled={!show}
            className="min-h-10 rounded-lg border border-blue-500 px-4 font-medium text-blue-700 disabled:opacity-40 dark:text-blue-300"
            onClick={() => show && onCreate({ ...show, title: show.title.trim() || "가져온 공연" })}
          >
            Show 만들기{show ? ` (${show.inputs.length}채널)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 콘솔 변경분 ───────────── */

export function ConsoleChanges({ show, opts, library, apply }: { show: Show; opts: Dm7Options; library: Library | null; apply: (fn: (s: Show) => Show) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ name: string; snap: ConsoleSnapshot } | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<string | null>(null);

  const changes: ImportChange[] = useMemo(() => (loaded ? diffSnapshot(show, loaded.snap) : []), [loaded, show]);
  const picked = changes.filter((c) => !off.has(c.key));

  const onFile = async (f: File) => {
    setError(null);
    setDone(null);
    try {
      const file = await readFile(f);
      setLoaded({ name: f.name, snap: readDm7(file, show.stageBoxes, opts.boxes) });
      setOff(new Set());
    } catch (e) {
      setLoaded(null);
      setError(errText(e));
    }
  };
  const run = () => {
    if (!loaded || !picked.length) return;
    const n = picked.length;
    apply((s) => applyImportChanges(s, picked, loaded.snap, { sources: library?.sources, groups: library?.groups }));
    setDone(`${n}개를 Show에 반영했습니다. Show 화면에서 실행 취소할 수 있습니다.`);
  };
  const groups = [...new Set(changes.map((c) => c.target))];

  return (
    <div>
      <p className="mb-2 text-xs text-neutral-500">
        현장에서 콘솔로 고친 뒤 저장한 쇼 파일을 올리면, 이 Show와 달라진 이름·컬러·패치·48V·페어·DCA·뮤트·버스만 보여 줍니다. 고른 것만 Show에 반영하고, 마이크·스탠드·비고는 건드리지 않습니다.
        스테이지박스 대응은 위 2번 설정을 씁니다.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".dmxf,.dm7f"
        aria-label="콘솔에서 저장한 쇼 파일"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      <button className={btn} onClick={() => fileRef.current?.click()}>
        콘솔에서 저장한 파일 고르기…
      </button>
      {loaded && <span className="ml-2 text-sm text-neutral-600 dark:text-neutral-400">{loaded.name}</span>}
      {error && <p className="mt-2 text-red-600">{error}</p>}
      {loaded && !changes.length && !done && <p className="mt-2 text-green-700 dark:text-green-300">Show와 달라진 것이 없습니다.</p>}
      {done && (
        <p role="status" className="mt-2 rounded border border-green-400 bg-green-50 px-3 py-2 text-xs text-green-900 dark:bg-green-950 dark:text-green-200">
          {done}
        </p>
      )}
      {changes.length > 0 && (
        <>
          <div className="mt-2 mb-1 flex flex-wrap items-center gap-2 text-xs">
            <b>달라진 것 {changes.length}개</b>
            <button className="underline" onClick={() => setOff(new Set())}>
              모두 고르기
            </button>
            <button className="underline" onClick={() => setOff(new Set(changes.map((c) => c.key)))}>
              모두 빼기
            </button>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
            <table className="w-full border-collapse text-left text-xs" aria-label="콘솔에서 달라진 것">
              <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-900">
                <tr>
                  <th className="w-8 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">대상</th>
                  <th className="px-2 py-1.5 font-medium">항목</th>
                  <th className="px-2 py-1.5 font-medium">지금 (Show)</th>
                  <th className="px-2 py-1.5 font-medium">콘솔</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((g) =>
                  changes
                    .filter((c) => c.target === g)
                    .map((c, i) => (
                      <tr key={c.key} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            aria-label={`${c.target} ${c.field} 반영`}
                            checked={!off.has(c.key)}
                            onChange={(e) =>
                              setOff((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.delete(c.key);
                                else n.add(c.key);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-1 font-semibold whitespace-nowrap">{i === 0 ? c.target : ""}</td>
                        <td className="px-2 py-1">{c.field}</td>
                        <td className="px-2 py-1 text-neutral-500">{c.before}</td>
                        <td className="px-2 py-1 font-medium">{c.after}</td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
          <button className={`${btn} mt-2 border-blue-500 font-medium text-blue-700 dark:text-blue-300`} disabled={!picked.length} onClick={run}>
            고른 {picked.length}개를 Show에 반영
          </button>
        </>
      )}
      {loaded && channelNotes(loaded.snap.channels.filter((c) => !c.isDefault)).length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
          {channelNotes(loaded.snap.channels.filter((c) => !c.isDefault)).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
