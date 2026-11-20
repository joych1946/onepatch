"use client";

/**
 * 콘솔 내보내기 (Yamaha DM7).
 * 1. 기준 파일: DM Editor에서 저장한 쇼 파일을 한 번 올리면 브라우저(IndexedDB)에 보관해 다음부터 다시 쓰지 않는다.
 * 2~3. 스테이지박스 대응·바꿀 항목
 * 4. 내보내기 전 점검: 글자 수를 넘는 이름(그 자리에서 고치기), 콘솔에 없는 컬러, 기종 한도, 오류 검사 경고
 * 5. 결과 요약과 내려받기: 무엇이 몇 개 들어가는지, 넣지 않는 것(→ 인쇄 화면 "콘솔 할 일")
 * 기준 파일에서 OnePatch가 다루지 않는 내용(EQ, 다이내믹스, 씬 등)은 바이트 그대로 둔다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { routes } from "@/lib/routes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Color } from "@/model/schema";
import { buildDm7File, Dm7FormatError, parseDm7File, type Dm7File } from "@/export/dm7/container";
import { applyDm7, defaultDm7Options, DM7_ITEMS, planDm7, type Dm7Options, type Dm7Plan } from "@/export/dm7/dm7Export";
import { dm7FileInfo, type Dm7FileInfo } from "@/export/dm7/fileInfo";
import { consoleTasks } from "@/export/dm7/tasks";
import { applyNameFix, exportChecks, type ExportCheck } from "@/export/checks";
import { profileByModel, DEFAULT_CONSOLE_PROFILE } from "@/export/profile";
import { downloadBlob, escGoesBack } from "@/lib/download";
import { dm7FileName } from "@/export/dm7/fileName";
import { showDocumentTitle } from "@/model/showInfo";
import { quantityIssues } from "@/model/library";
import { COLOR_LABEL } from "@/model/labels";
import { deleteConsoleBase, getConsoleBase, putConsoleBase } from "@/storage/consoleFileStore";
import { useShowDoc } from "./useShowDoc";
import { useLibrary } from "./useLibrary";
import { ConsoleChanges } from "./Dm7Import";

const KEY = (id: string) => `onepatch.dm7.${id}`;
const BASE_KEY = "dm7";
const PRINT_KEY = "onepatch.print";

type Base = { name: string; uploadedAt: string; file: Dm7File; info: Dm7FileInfo };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "알 수 없음");

export default function ConsoleExportView({ id }: { id: string }) {
  const doc = useShowDoc(id);
  const lib = useLibrary();
  const { show } = doc;
  const [base, setBase] = useState<Base | null | undefined>(undefined);
  const [fileError, setFileError] = useState<string | null>(null);
  const [opts, setOpts] = useState<Dm7Options | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  // Esc: Show 화면으로 돌아가기 (입력 칸에서는 동작하지 않음)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!escGoesBack(e)) return;
      e.preventDefault();
      router.push(routes.show(id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, id]);

  const title = show?.title;
  useEffect(() => {
    if (title === undefined) return;
    const prev = document.title;
    document.title = showDocumentTitle({ title }, "콘솔 내보내기");
    return () => {
      document.title = prev;
    };
  }, [title]);

  // 보관한 기준 파일
  useEffect(() => {
    getConsoleBase(BASE_KEY).then(
      (b) => {
        if (!b) return setBase(null);
        try {
          const file = parseDm7File(b.bytes);
          setBase({ name: b.name, uploadedAt: b.uploadedAt, file, info: dm7FileInfo(file) });
        } catch (e) {
          setBase(null);
          setFileError(`보관한 기준 파일을 읽지 못했습니다. 다시 올려 주세요. (${e instanceof Error ? e.message : String(e)})`);
        }
      },
      (e) => {
        setBase(null);
        setFileError(`보관한 기준 파일을 불러오지 못했습니다: ${String(e)}`);
      },
    );
  }, []);

  // 내보내기 설정 (Show마다)
  const showLoaded = !!show;
  useEffect(() => {
    if (!showLoaded || !show) return;
    const def = defaultDm7Options(show);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as Dm7Options | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpts(
        saved
          ? {
              ...def,
              ...saved,
              items: { ...def.items, ...saved.items },
              // 박스마다 합친다 (예전 설정에 없는 항목은 기본값)
              boxes: Object.fromEntries(Object.entries(def.boxes).map(([k, v]) => [k, { ...v, ...saved.boxes?.[k] }])),
            }
          : def,
      );
    } catch {
      setOpts(def);
    }
    // 설정은 Show를 처음 불러왔을 때 한 번만 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLoaded, id]);

  const update = (next: Dm7Options) => {
    setOpts(next);
    setDownloaded(null);
    try {
      localStorage.setItem(KEY(id), JSON.stringify(next));
    } catch {}
  };

  const profile = base ? profileByModel(base.file.model) : DEFAULT_CONSOLE_PROFILE;
  const sources = lib.library?.sources;

  const result = useMemo((): { plan: Dm7Plan } | { error: string } | null => {
    if (!show || !base || !opts) return null;
    try {
      return { plan: planDm7(show, base.file, opts, { sources }) };
    } catch (e) {
      return { error: String(e instanceof Error ? e.message : e) };
    }
  }, [show, base, opts, sources]);

  const checks = useMemo((): ExportCheck[] => {
    if (!show || !opts) return [];
    const issues = [...doc.warnings, ...(lib.library ? quantityIssues(lib.library, show) : [])];
    return exportChecks(show, profile, { colorMap: opts.colorMap, issues });
  }, [show, opts, profile, doc.warnings, lib.library]);

  const tasks = useMemo(() => (show ? consoleTasks(show, profile) : []), [show, profile]);

  const onFile = async (f: File) => {
    setFileError(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const file = parseDm7File(bytes);
      const uploadedAt = new Date().toISOString();
      await putConsoleBase(BASE_KEY, { name: f.name, bytes, uploadedAt });
      setBase({ name: f.name, uploadedAt, file, info: dm7FileInfo(file) });
      setDownloaded(null);
    } catch (e) {
      setFileError(e instanceof Dm7FormatError ? e.message : `파일을 읽지 못했습니다: ${String(e)}`);
    }
  };

  const removeBase = async () => {
    if (!base || !confirm(`보관한 기준 파일 “${base.name}”을(를) 지울까요? 다음 내보내기 때 다시 올려야 합니다.`)) return;
    await deleteConsoleBase(BASE_KEY);
    setBase(null);
    setDownloaded(null);
  };

  const download = () => {
    if (!show || !base || !result || !("plan" in result)) return;
    const bytes = buildDm7File(applyDm7(base.file, result.plan));
    const name = dm7FileName(show, base.name);
    downloadBlob(name, new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    setDownloaded(name);
  };

  const openTasks = () => {
    try {
      const cur = JSON.parse(localStorage.getItem(PRINT_KEY) ?? "{}");
      localStorage.setItem(PRINT_KEY, JSON.stringify({ ...cur, doc: "tasks" }));
    } catch {}
    router.push(routes.print(id));
  };

  if (doc.loadError) return <main className="p-6 whitespace-pre-wrap text-red-600">{doc.loadError}</main>;
  if (doc.notFound)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show || !opts || base === undefined) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const input = "rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700";
  const step = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";
  const btn = "rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";
  const plan = result && "plan" in result ? result.plan : null;
  const problemCount = checks.length + (plan?.warnings.length ?? 0);
  // 인풋은 채널 번호 순, 그 뒤에 아웃풋 포트
  const keyOf = (c: Dm7Plan["changes"][number]) => c.target ?? `Ch ${c.ch}`;
  const byCh = plan
    ? [...new Set(plan.changes.map(keyOf))]
        .map((key) => ({ key, list: plan.changes.filter((c) => keyOf(c) === key) }))
        .sort((a, b) => (a.list[0].ch || 1e9) - (b.list[0].ch || 1e9))
    : [];
  const num = (v: number | null, on: (n: number | null) => void, label: string, max: number) => (
    <input
      type="number"
      min={1}
      max={max}
      className={`${input} w-20`}
      value={v ?? ""}
      placeholder="—"
      aria-label={label}
      onChange={(e) => on(e.target.value === "" ? null : Math.max(1, Math.min(max, Math.round(Number(e.target.value)) || 1)))}
    />
  );
  const setColor = (color: Color, value: string) => update({ ...opts, colorMap: { ...opts.colorMap, [color]: value } });
  const nameChecks = checks.filter((c): c is Extract<ExportCheck, { kind: "name" }> => c.kind === "name");
  const fixAllNames = () =>
    doc.apply((s) => nameChecks.reduce((acc, c) => applyNameFix(acc, c.ref, c.suggestion), s));

  return (
    <main className="mx-auto w-full max-w-[1000px] space-y-5 p-4 text-sm sm:p-6">
      <header>
        <Link href={routes.show(show.id)} className="text-neutral-500 hover:underline">
          ← {show.title} <kbd>Esc</kbd>
        </Link>
        <h1 className="mt-1 text-2xl font-bold">콘솔 내보내기 — {profile.name}</h1>
        <p className="text-neutral-500">
          DM Editor에서 저장한 기준 쇼 파일에 인풋 설정·아웃풋 패치·이름만 OnePatch 데이터로 넣습니다. EQ·다이내믹스·씬 등 나머지는 그대로입니다.
        </p>
      </header>

      <section className={step} aria-label="기준 파일">
        <h2 className="mb-2 font-semibold">1. 기준 파일</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".dmxf,.dm7f"
          aria-label="DM7 쇼 파일"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        {base ? (
          <div className="flex flex-wrap items-start gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-neutral-500">파일</dt>
              <dd className="font-medium">{base.name}</dd>
              <dt className="text-neutral-500">기종</dt>
              <dd>{base.info.modelName}</dd>
              <dt className="text-neutral-500">형식 버전</dt>
              <dd>
                {base.file.formatVersion.startsWith("02") ? "DM Editor 2.x" : base.file.formatVersion.startsWith("01") ? "DM Editor 1.x" : "알 수 없음"}{" "}
                <span className="text-xs text-neutral-500">({base.file.formatVersion})</span>
              </dd>
              <dt className="text-neutral-500">저장 시각</dt>
              <dd>
                {when(base.info.savedAt)} <span className="text-xs text-neutral-500">· 올린 시각 {when(base.uploadedAt)}</span>
              </dd>
            </dl>
            <div className="ml-auto flex gap-2">
              <button className={btn} onClick={() => fileRef.current?.click()}>
                교체
              </button>
              <button className={`${btn} text-red-600`} onClick={() => void removeBase()}>
                삭제
              </button>
            </div>
            <p className="w-full text-xs text-neutral-500">이 브라우저에 보관되어 모든 Show에서 씁니다. 콘솔의 설정(EQ·씬 등)이 바뀌었으면 새로 저장한 파일로 교체하세요.</p>
          </div>
        ) : (
          <>
            <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-xs text-neutral-600 dark:text-neutral-400">
              <li>DM Editor(콘솔 펌웨어와 같은 버전)에서 쓸 쇼를 열거나 새로 만든 뒤 <b>File → Save As</b>로 저장합니다 (.dmxf). 콘솔에서 USB로 저장한 파일도 됩니다.</li>
              <li>한 번 올리면 이 브라우저에 보관되어, 다음부터는 다시 올리지 않아도 됩니다.</li>
            </ol>
            <button className={`${btn} border-blue-500 font-medium text-blue-700 dark:text-blue-300`} onClick={() => fileRef.current?.click()}>
              기준 파일 올리기…
            </button>
          </>
        )}
        {fileError && <p className="mt-2 text-red-600">{fileError}</p>}
      </section>

      <section className={step}>
        <h2 className="mb-2 font-semibold">2. 스테이지박스 → DM7 입력</h2>
        <p className="mb-2 text-xs text-neutral-500">
          박스의 1번 포트가 DM7의 몇 번 Dante 입력으로 들어오는지 적습니다 (Dante Controller의 패치와 같게). 콘솔 본체 단자(OMNI n)는 OMNI로, “Dante n”(박스 없는 Dante 직결)은 그 번호의 Dante 입력으로 들어갑니다.
          48V는 Dante I/O 장치 쪽 설정이라 I/O 유닛 번호가 필요합니다 — Rio 앞면의 UNIT ID와 같은 번호입니다(DM7 Dante I/O Device 화면의 #번호). 비우면 48V는 쓰지 않습니다.
        </p>
        <table className="w-full max-w-xl border-collapse text-left">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="py-1 pr-3 font-medium">박스</th>
              <th className="py-1 pr-3 font-medium">Dante 시작 번호</th>
              <th className="py-1 pr-3 font-medium">→ 범위</th>
              <th className="py-1 pr-3 font-medium">48V용 I/O 유닛 (= Rio UNIT ID)</th>
              <th className="py-1 font-medium">Dante OUT 시작 번호</th>
            </tr>
          </thead>
          <tbody>
            {show.stageBoxes.map((b) => {
              const s = opts.boxes[b.id] ?? { danteStart: null, ioUnit: null };
              const set = (patch: Partial<typeof s>) => update({ ...opts, boxes: { ...opts.boxes, [b.id]: { ...s, ...patch } } });
              return (
                <tr key={b.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1.5 pr-3">{b.name}</td>
                  <td className="py-1.5 pr-3">{num(s.danteStart, (v) => set({ danteStart: v }), `${b.name} Dante 시작 번호`, 512)}</td>
                  <td className="py-1.5 pr-3 text-xs text-neutral-500">{s.danteStart ? `Dante ${s.danteStart}–${s.danteStart + b.inputs - 1}` : "패치 안 함"}</td>
                  <td className="py-1.5 pr-3">{num(s.ioUnit, (v) => set({ ioUnit: v }), `${b.name} I/O 유닛`, 24)}</td>
                  <td className="py-1.5">
                    {num(s.danteOutStart ?? null, (v) => set({ danteOutStart: v }), `${b.name} Dante OUT 시작 번호`, 144)}
                    <span className="ml-2 text-xs text-neutral-500">{s.danteOutStart ? `${s.danteOutStart}–${s.danteOutStart + b.outputs - 1}` : ""}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={step}>
        <h2 className="mb-2 font-semibold">3. 바꿀 항목</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {DM7_ITEMS.map((it) => (
            <label key={it.key} className="flex items-center gap-1.5">
              <input type="checkbox" checked={opts.items[it.key]} onChange={(e) => update({ ...opts, items: { ...opts.items, [it.key]: e.target.checked } })} />
              {it.label}
              {it.note && <span className="text-xs text-neutral-500">({it.note})</span>}
            </label>
          ))}
        </div>
        {opts.items.outPatch && (
          <label className="mt-2 flex items-center gap-1.5">
            <input type="checkbox" checked={!!opts.clearUnusedOutputs} onChange={(e) => update({ ...opts, clearUnusedOutputs: e.target.checked })} />
            OnePatch에 없는 출력은 비우기
            <span className="text-xs text-neutral-500">(OMNI OUT 전부와 박스의 Dante OUT 범위 중 쓰지 않는 포트를 “없음”으로 — 기본 패치가 엉뚱한 곳으로 나가는 것을 막음)</span>
          </label>
        )}
      </section>

      <section className={step} aria-label="내보내기 전 점검">
        <h2 className="mb-2 font-semibold">
          4. 내보내기 전 점검{" "}
          {problemCount ? (
            <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">경고 {problemCount}개</span>
          ) : (
            <span className="ml-1 rounded bg-green-100 px-1.5 text-xs text-green-800 dark:bg-green-950 dark:text-green-200">경고 0개</span>
          )}
        </h2>
        {!problemCount && <p className="text-neutral-500">이름 글자 수, 컬러, {profile.name} 한도, 오류 검사 모두 문제 없습니다.</p>}

        {nameChecks.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="font-medium">{profile.nameMax}자를 넘는 이름 ({nameChecks.length})</h3>
              <button className={`${btn} text-xs`} onClick={fixAllNames}>
                모두 제안대로
              </button>
              <span className="text-xs text-neutral-500">고친 이름은 Show에 저장됩니다 (실행 취소는 Show 화면에서).</span>
            </div>
            <ul className="space-y-1">
              {nameChecks.map((c) => (
                <NameFix key={c.key + c.current} check={c} max={profile.nameMax} onApply={(v) => doc.apply((s) => applyNameFix(s, c.ref, v))} />
              ))}
            </ul>
          </div>
        )}

        {checks.some((c) => c.kind === "color") && (
          <div className="mb-3">
            <h3 className="mb-1 font-medium">{profile.name}에 없는 컬러</h3>
            <ul className="space-y-1">
              {checks.flatMap((c) =>
                c.kind === "color"
                  ? [
                      <li key={c.key} className="flex flex-wrap items-center gap-2">
                        <span className="w-16">{c.label}</span>
                        <span className="text-xs text-neutral-500">Ch {c.channels.join(", ")}</span>
                        <span>→</span>
                        <ColorPick value={opts.colorMap?.[c.color] ?? c.suggestion} colors={profile.colors} label={`${c.label} 대신 쓸 컬러`} onPick={(v) => setColor(c.color, v)} />
                        <button className={`${btn} text-xs`} onClick={() => setColor(c.color, opts.colorMap?.[c.color] ?? c.suggestion)}>
                          이 컬러로 확인
                        </button>
                      </li>,
                    ]
                  : [],
              )}
            </ul>
          </div>
        )}

        {(checks.some((c) => c.kind === "limit" || c.kind === "issue") || (plan?.warnings.length ?? 0) > 0) && (
          <ul className="list-disc space-y-0.5 rounded border border-amber-400 bg-amber-50 py-2 pr-3 pl-7 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {checks.map((c) => (c.kind === "limit" ? <li key={c.key}>{c.message}</li> : null))}
            {plan?.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
            {checks.map((c) =>
              c.kind === "issue" ? (
                <li key={c.key}>
                  오류 검사: {c.message}{" "}
                  <Link href={routes.show(show.id)} className="underline">
                    Show에서 고치기
                  </Link>
                </li>
              ) : null,
            )}
          </ul>
        )}
        {Object.keys(opts.colorMap ?? {}).length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            컬러 대응:{" "}
            {Object.entries(opts.colorMap ?? {}).map(([k, v]) => `${COLOR_LABEL[k as Color]} → ${v}`).join(", ")}{" "}
            <button className="underline" onClick={() => update({ ...opts, colorMap: {} })}>
              처음대로
            </button>
          </p>
        )}
      </section>

      <section className={step} aria-label="결과 요약과 내려받기">
        <h2 className="mb-2 font-semibold">5. 결과 요약과 내려받기</h2>
        {!base && <p className="text-neutral-500">기준 파일을 올리면 들어갈 내용이 여기 나옵니다.</p>}
        {result && "error" in result && <p className="text-red-600">이 파일에서 필요한 항목을 찾지 못했습니다: {result.error}</p>}
        {plan && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 font-medium">들어가는 것</h3>
                <table className="w-full text-left text-xs" aria-label="들어가는 것">
                  <thead className="text-neutral-500">
                    <tr>
                      <th className="py-0.5 font-medium">항목</th>
                      <th className="py-0.5 text-right font-medium">넣음</th>
                      <th className="py-0.5 text-right font-medium">그중 바뀜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DM7_ITEMS.filter((it) => opts.items[it.key]).map((it) => (
                      <tr key={it.key} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="py-0.5">{it.label}</td>
                        <td className="py-0.5 text-right tabular-nums">{plan.stats[it.key].total}</td>
                        <td className="py-0.5 text-right tabular-nums">{plan.stats[it.key].changed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="mb-1 font-medium">넣지 않는 것</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-xs">
                  {DM7_ITEMS.filter((it) => !opts.items[it.key]).map((it) => (
                    <li key={it.key}>{it.label} (3번에서 끔)</li>
                  ))}
                  <li>게인 · HPF · EQ · 다이내믹스, Aux 센드 Pre/Post, 버스의 스테레오 설정(Bus Setup), Matrix 소스, FX</li>
                  {plan.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                <button className={`${btn} mt-2 text-xs`} onClick={openTasks}>
                  콘솔에서 직접 할 일 {tasks.length}개 — 인쇄 화면에서 체크리스트 보기
                </button>
              </div>
            </div>

            {plan.busMap.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">OnePatch 버스 → DM7 버스 ({plan.busMap.length})</summary>
                <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                  {plan.busMap.map((m, i) => (
                    <li key={i}>
                      {m.bus} → <b>{m.dm7}</b>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
                파일과 달라 바뀌는 값 {plan.changes.length}개 ({byCh.length}곳)
              </summary>
              {plan.changes.length > 0 && (
                <div className="mt-1 max-h-[50vh] overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-900">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">대상</th>
                        <th className="px-2 py-1.5 font-medium">항목</th>
                        <th className="px-2 py-1.5 font-medium">지금 (파일)</th>
                        <th className="px-2 py-1.5 font-medium">바뀔 값</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCh.flatMap(({ key, list }) =>
                        list.map((c, i) => (
                          <tr key={`${key}-${i}`} className="border-t border-neutral-200 dark:border-neutral-800">
                            <td className="px-2 py-1 font-semibold whitespace-nowrap tabular-nums">{i === 0 ? key : ""}</td>
                            <td className="px-2 py-1">{c.field}</td>
                            <td className="px-2 py-1 text-neutral-500">{c.before}</td>
                            <td className="px-2 py-1 font-medium">{c.after}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </details>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={download}
                className={`rounded border px-4 py-2 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  problemCount ? "border-amber-500 text-amber-800 dark:text-amber-200" : "border-blue-500 text-blue-700 dark:text-blue-300"
                }`}
              >
                {problemCount ? `경고 ${problemCount}개 남음 — 그래도 내려받기` : "내려받기"}
              </button>
              <span className="text-xs text-neutral-500">
                → <b className="font-medium">{dm7FileName(show, base?.name ?? ".dmxf")}</b> · 기준 파일은 바뀌지 않습니다.
              </span>
            </div>
            {downloaded && (
              <p role="status" className="mt-2 rounded border border-green-400 bg-green-50 px-3 py-2 text-xs text-green-900 dark:bg-green-950 dark:text-green-200">
                내려받았습니다: <b>{downloaded}</b> — 이름 {plan.stats.name.total}, 패치 {plan.stats.patch.total}, 48V 포트 {plan.stats.phantom.total}, 아웃풋 패치{" "}
                {plan.stats.outPatch.total}, 버스·DCA·뮤트 이름 {plan.stats.busNames.total}
              </p>
            )}
            <p className="mt-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              ⚠️ DM7 쇼 파일 형식은 Yamaha가 공개하지 않았습니다(OnePatch가 DM Editor 저장 파일을 비교해 맞춘 방식). 콘솔에 넣기 전에 반드시{" "}
              <b>DM Editor로 내려받은 파일을 열어 확인</b>하고, 이상이 없으면 USB로 옮기세요.
            </p>
          </>
        )}
      </section>

      <section className={step} aria-label="콘솔에서 고친 내용 가져오기">
        <h2 className="mb-2 font-semibold">6. 콘솔에서 고친 내용 가져오기</h2>
        <ConsoleChanges show={show} opts={opts} library={lib.library} apply={doc.apply} />
      </section>
    </main>
  );
}

/** 글자 수를 넘는 이름 한 줄: 제안을 고쳐서 적용 (Enter) */
function NameFix({ check, max, onApply }: { check: Extract<ExportCheck, { kind: "name" }>; max: number; onApply: (v: string) => void }) {
  const [v, setV] = useState(check.suggestion);
  const n = [...v.trim()].length;
  const ok = n > 0 && n <= max;
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="w-24 font-medium tabular-nums">{check.target}</span>
      <span className="text-red-600 line-through decoration-red-300">{check.current}</span>
      <span>→</span>
      <input
        value={v}
        aria-label={`${check.target} 새 이름`}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && ok) {
            e.preventDefault();
            onApply(v);
          }
        }}
        className={`w-32 rounded border bg-transparent px-2 py-0.5 font-mono ${ok ? "border-neutral-300 dark:border-neutral-700" : "border-red-500"}`}
      />
      <span className={`text-xs tabular-nums ${ok ? "text-neutral-500" : "text-red-600"}`}>
        {n}/{max}
      </span>
      <button
        disabled={!ok}
        onClick={() => onApply(v)}
        className="rounded border border-blue-500 px-2 py-0.5 text-xs text-blue-700 disabled:opacity-40 dark:text-blue-300"
      >
        적용
      </button>
    </li>
  );
}

function ColorPick({ value, colors, label, onPick }: { value: string; colors: { value: string; label: string; hex: string }[]; label: string; onPick: (v: string) => void }) {
  const hex = colors.find((c) => c.value === value)?.hex;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-3 w-3 rounded-sm border border-neutral-400" style={{ background: hex }} />
      <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)} className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700">
        {colors.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </span>
  );
}
