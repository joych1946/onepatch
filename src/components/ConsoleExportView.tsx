"use client";

/**
 * 콘솔 내보내기 (Yamaha DM7): DM Editor에서 저장한 쇼 파일을 올리면
 * 인풋 이름·컬러·아이콘·패치·48V·페어·DCA·뮤트만 OnePatch 데이터로 바꿔서 내려준다.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Show } from "@/model/schema";
import { getShow } from "@/storage/showStore";
import { buildDm7File, Dm7FormatError, parseDm7File, type Dm7File } from "@/export/dm7/container";
import { applyDm7, defaultDm7Options, DM7_COLOR, DM7_ITEMS, planDm7, type Dm7Options, type Dm7Plan } from "@/export/dm7/dm7Export";
import { COLOR_LABEL } from "@/model/labels";
import { downloadBlob } from "@/lib/download";

const KEY = (id: string) => `onepatch.dm7.${id}`;

export default function ConsoleExportView({ id }: { id: string }) {
  const [show, setShow] = useState<Show | null | undefined>(undefined);
  const [file, setFile] = useState<{ name: string; data: Dm7File } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [opts, setOpts] = useState<Dm7Options | null>(null);

  useEffect(() => {
    getShow(id).then((s) => {
      setShow(s);
      if (!s) return;
      const def = defaultDm7Options(s);
      try {
        const saved = JSON.parse(localStorage.getItem(KEY(id)) ?? "null") as Dm7Options | null;
        // 저장된 설정 + 새로 생긴 박스는 기본값
        setOpts(saved ? { items: { ...def.items, ...saved.items }, boxes: { ...def.boxes, ...saved.boxes } } : def);
      } catch {
        setOpts(def);
      }
    });
  }, [id]);

  const update = (next: Dm7Options) => {
    setOpts(next);
    try {
      localStorage.setItem(KEY(id), JSON.stringify(next));
    } catch {}
  };

  const result = useMemo((): { plan: Dm7Plan } | { error: string } | null => {
    if (!show || !file || !opts) return null;
    try {
      return { plan: planDm7(show, file.data, opts) };
    } catch (e) {
      return { error: String(e instanceof Error ? e.message : e) };
    }
  }, [show, file, opts]);

  const onFile = async (f: File) => {
    setFileError(null);
    try {
      setFile({ name: f.name, data: parseDm7File(new Uint8Array(await f.arrayBuffer())) });
    } catch (e) {
      setFile(null);
      setFileError(e instanceof Dm7FormatError ? e.message : `파일을 읽지 못했습니다: ${String(e)}`);
    }
  };

  const download = () => {
    if (!file || !result || !("plan" in result)) return;
    const bytes = buildDm7File(applyDm7(file.data, result.plan));
    const m = file.name.match(/^(.*?)(\.dm7f)?(\.dmxf|\.dm7f)$/i);
    const base = m ? m[1] : file.name;
    const ext = m ? m[3] : ".dmxf";
    downloadBlob(`${base}_OnePatch${ext}`, new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  };

  if (show === null)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show || !opts) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const input = "rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700";
  const step = "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800";
  const plan = result && "plan" in result ? result.plan : null;
  const byCh = plan
    ? [...new Set(plan.changes.map((c) => c.ch))].sort((a, b) => a - b).map((ch) => ({ ch, list: plan.changes.filter((c) => c.ch === ch) }))
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

  return (
    <main className="mx-auto w-full max-w-[1000px] space-y-5 p-4 text-sm sm:p-6">
      <header>
        <Link href={`/shows/${show.id}`} className="text-neutral-500 hover:underline">
          ← {show.title}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">콘솔 내보내기 — Yamaha DM7</h1>
        <p className="text-neutral-500">
          DM Editor에서 저장한 쇼 파일의 인풋 설정만 OnePatch 데이터로 바꿔 줍니다. EQ·다이내믹스·네트워크 등 나머지는 그대로입니다.
        </p>
      </header>

      <section className={step}>
        <h2 className="mb-2 font-semibold">1. DM Editor에서 저장한 파일 올리기</h2>
        <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-xs text-neutral-600 dark:text-neutral-400">
          <li>DM Editor(콘솔 펌웨어와 같은 버전)에서 쓸 쇼를 열거나 새로 만든 뒤 <b>File → Save As</b>로 저장합니다 (.dmxf).</li>
          <li>그 파일을 아래에 올립니다. 콘솔에서 USB로 저장한 파일도 됩니다.</li>
        </ol>
        <input
          type="file"
          accept=".dmxf,.dm7f"
          aria-label="DM7 쇼 파일"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          className="text-sm file:mr-3 file:rounded file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 dark:file:border-neutral-700"
        />
        {fileError && <p className="mt-2 text-red-600">{fileError}</p>}
        {file && (
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">
            {file.name} · 기종 <b>{file.data.model === "DM7C" ? "DM7 Compact" : "DM7"}</b> · 형식 {file.data.formatVersion}
            {plan && ` · 인풋 ${plan.maxChannels}채널`}
          </p>
        )}
      </section>

      <section className={step}>
        <h2 className="mb-2 font-semibold">2. 스테이지박스 → DM7 입력</h2>
        <p className="mb-2 text-xs text-neutral-500">
          박스의 1번 포트가 DM7의 몇 번 Dante 입력으로 들어오는지 적습니다 (Dante Controller의 패치와 같게). 콘솔 로컬 포트(Local)는 OMNI로 들어갑니다.
          48V는 Dante I/O 장치 쪽 설정이라 그 장치가 DM7에서 몇 번 I/O 유닛인지 알아야 합니다 — 모르면 비워 두세요(48V는 쓰지 않음).
        </p>
        <table className="w-full max-w-xl border-collapse text-left">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="py-1 pr-3 font-medium">박스</th>
              <th className="py-1 pr-3 font-medium">Dante 시작 번호</th>
              <th className="py-1 pr-3 font-medium">→ 범위</th>
              <th className="py-1 font-medium">48V용 I/O 유닛 (확인 필요)</th>
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
                  <td className="py-1.5">{num(s.ioUnit, (v) => set({ ioUnit: v }), `${b.name} I/O 유닛`, 24)}</td>
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
        <p className="mt-2 text-xs text-neutral-500">
          컬러 대응:{" "}
          {Object.entries(DM7_COLOR)
            .map(([k, v]) => `${COLOR_LABEL[k as keyof typeof COLOR_LABEL]}→${v.value}${v.approx ? "(근사)" : ""}`)
            .join(", ")}{" "}
          · 컬러 “없음”인 채널은 파일의 컬러를 그대로 둡니다.
        </p>
      </section>

      <section className={step}>
        <h2 className="mb-2 font-semibold">4. 바뀔 내용 확인 후 내려받기</h2>
        {!file && <p className="text-neutral-500">파일을 올리면 바뀔 내용이 여기 나옵니다.</p>}
        {result && "error" in result && <p className="text-red-600">이 파일에서 필요한 항목을 찾지 못했습니다: {result.error}</p>}
        {plan && (
          <>
            {plan.warnings.length > 0 && (
              <ul className="mb-3 list-disc space-y-0.5 rounded border border-amber-400 bg-amber-50 py-2 pr-3 pl-7 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <p className="mb-2">
              {plan.changes.length ? (
                <>
                  <b>{byCh.length}채널</b>, 바뀌는 값 <b>{plan.changes.length}개</b>
                </>
              ) : (
                "바뀌는 내용이 없습니다 (파일이 이미 같습니다)."
              )}
            </p>
            {plan.changes.length > 0 && (
              <div className="max-h-[50vh] overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-900">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Ch</th>
                      <th className="px-2 py-1.5 font-medium">항목</th>
                      <th className="px-2 py-1.5 font-medium">지금 (파일)</th>
                      <th className="px-2 py-1.5 font-medium">바뀔 값</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCh.flatMap(({ ch, list }) =>
                      list.map((c, i) => (
                        <tr key={`${ch}-${i}`} className={`border-t border-neutral-200 dark:border-neutral-800 ${i === 0 ? "" : "text-neutral-700 dark:text-neutral-300"}`}>
                          <td className="px-2 py-1 font-semibold tabular-nums">{i === 0 ? ch : ""}</td>
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={download}
                disabled={!plan.changes.length}
                className="rounded border border-blue-500 px-4 py-2 font-medium text-blue-700 hover:bg-neutral-100 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-neutral-800"
              >
                바꾼 파일 내려받기
              </button>
              <span className="text-xs text-neutral-500">원본 파일은 바뀌지 않습니다.</span>
            </div>
            <p className="mt-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
              ⚠️ DM7 쇼 파일 형식은 Yamaha가 공개하지 않았습니다(OnePatch가 DM Editor 저장 파일을 비교해 맞춘 방식). 콘솔에 넣기 전에 반드시{" "}
              <b>DM Editor로 내려받은 파일을 열어 확인</b>하고, 이상이 없으면 DM Editor에서 다시 저장해 USB로 옮기세요.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
