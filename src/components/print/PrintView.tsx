"use client";

/**
 * 출력 화면: 크루 배포용 출력물 미리보기 + 인쇄(PDF 저장) + 엑셀/CSV.
 * 미리보기의 쪽 구성이 그대로 인쇄된다 (쪽 나누기는 components/print/Paged).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Show } from "@/model/schema";
import { getShow } from "@/storage/showStore";
import {
  equipmentSummary,
  INPUT_REPORT_COLUMNS,
  inputReportRows,
  LABEL_SHEETS,
  micTypeLabel,
  OUTPUT_REPORT_COLUMNS,
  outputReportSections,
  type LabelSheet,
  type ReportColumn,
} from "@/model/reports";
import { buildShowXlsx, fileBase, toCsv } from "@/lib/showExport";
import { downloadBlob, downloadText, isTypingTarget } from "@/lib/download";
import { useLibrary } from "../useLibrary";
import { PagedTable, type Orientation, type PagedItem } from "./Paged";
import { CableLabels, PatchSheets, StripLabels } from "./Docs";

type Doc = "inputs" | "outputs" | "patch" | "summary" | "cable" | "strip";
const DOCS: { id: Doc; name: string; orientation: Orientation }[] = [
  { id: "inputs", name: "인풋리스트", orientation: "landscape" },
  { id: "outputs", name: "아웃풋 리스트", orientation: "landscape" },
  { id: "patch", name: "패치 시트", orientation: "landscape" },
  { id: "summary", name: "장비 집계표", orientation: "portrait" },
  { id: "strip", name: "콘솔 스트립 라벨", orientation: "landscape" },
  { id: "cable", name: "멀티케이블 라벨", orientation: "portrait" },
];

type Settings = {
  doc: Doc;
  inputCols: string[];
  outputCols: string[];
  fontPt: number;
  spare: number;
  labelSheet: string;
  custom: LabelSheet;
  startAt: number;
  perStrip: number;
  cellMm: number;
  stripMm: number;
  zoom: number;
};

const KEY = "onepatch.print";
const DEFAULTS: Settings = {
  doc: "inputs",
  inputCols: INPUT_REPORT_COLUMNS.filter((c) => c.default).map((c) => c.key),
  outputCols: OUTPUT_REPORT_COLUMNS.filter((c) => c.default).map((c) => c.key),
  fontPt: 9,
  spare: 10,
  labelSheet: LABEL_SHEETS[1].id,
  custom: { ...LABEL_SHEETS[1], id: "custom", name: "직접 입력" },
  startAt: 1,
  perStrip: 8,
  cellMm: 30,
  stripMm: 16,
  zoom: 0.75,
};

const SUMMARY_COLUMNS: ReportColumn[] = [
  { key: "item", label: "항목", width: 38 },
  { key: "count", label: "수량", width: 9, align: "right" },
  { key: "owned", label: "보유", width: 9, align: "right" },
  { key: "extra", label: "", width: 12, align: "right" },
  { key: "note", label: "비고", width: 32 },
];

export default function PrintView({ id }: { id: string }) {
  const router = useRouter();
  const [show, setShow] = useState<Show | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { library } = useLibrary();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [printedAt] = useState(() => new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }));

  useEffect(() => {
    getShow(id).then(setShow, (e) => setError(String(e)));
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && typeof saved === "object") setS({ ...DEFAULTS, ...saved, custom: { ...DEFAULTS.custom, ...saved.custom } });
    } catch {}
  }, [id]);

  const set = (patch: Partial<Settings>) =>
    setS((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const doc = DOCS.find((d) => d.id === s.doc) ?? DOCS[0];

  // PDF로 저장할 때 파일 이름이 되도록
  useEffect(() => {
    if (!show) return;
    const prev = document.title;
    document.title = fileBase(show, doc.name);
    return () => {
      document.title = prev;
    };
  }, [show, doc.name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Esc: Show 화면으로 돌아가기 (Show 화면에서 P로 들어온 것의 반대)
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(`/shows/${id}`);
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= DOCS.length) {
        e.preventDefault();
        set({ doc: DOCS[n - 1].id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const inputCols = useMemo(() => INPUT_REPORT_COLUMNS.filter((c) => s.inputCols.includes(c.key)), [s.inputCols]);
  const outputCols = useMemo(() => OUTPUT_REPORT_COLUMNS.filter((c) => s.outputCols.includes(c.key)), [s.outputCols]);
  const labelSheet = s.labelSheet === "custom" ? s.custom : (LABEL_SHEETS.find((l) => l.id === s.labelSheet) ?? LABEL_SHEETS[0]);

  const inputItems = useMemo<PagedItem[]>(() => (show ? inputReportRows(show).map((r) => ({ kind: "row", cells: r.cells, color: r.color })) : []), [show]);
  const outputItems = useMemo<PagedItem[]>(
    () => (show ? outputReportSections(show).flatMap((sec) => [{ kind: "section" as const, title: sec.title }, ...sec.rows.map((r) => ({ kind: "row" as const, cells: r.cells }))]) : []),
    [show],
  );
  const summaryItems = useMemo<PagedItem[]>(() => {
    if (!show) return [];
    const eq = equipmentSummary(show, library, s.spare);
    const items: PagedItem[] = [
      { kind: "section", title: "마이크·DI 모델별 수량" },
      { kind: "subhead", labels: { item: "모델 (종류)", count: "수량", owned: "보유", extra: "부족", note: "채널" } },
      ...eq.mics.map((m) => ({
        kind: "row" as const,
        cells: {
          item: `${m.model}${m.type ? ` (${micTypeLabel(m.type)})` : ""}`,
          count: m.count,
          owned: m.owned ?? "—",
          extra: m.owned !== null && m.count > m.owned ? `${m.count - m.owned} 부족` : "",
          note: m.channels.join(", "),
        },
      })),
      { kind: "section", title: "스탠드 종류별 수량" },
      { kind: "subhead", labels: { item: "종류", count: "수량", note: "채널" } },
      ...eq.stands.map((x) => ({ kind: "row" as const, cells: { item: x.stand, count: x.count, note: x.channels.join(", ") } })),
      { kind: "section", title: "DI" },
      { kind: "subhead", labels: { item: "종류", count: "수량" } },
      { kind: "row", cells: { item: "액티브 (48V 필요)", count: eq.di.active } },
      { kind: "row", cells: { item: "패시브", count: eq.di.passive } },
      ...(eq.di.unknown ? [{ kind: "row" as const, cells: { item: "48V 미확인", count: eq.di.unknown } }] : []),
      { kind: "row", cells: { item: "합계", count: eq.di.total } },
      { kind: "section", title: "케이블 (연결 수 기준 추정 · 길이 제외)" },
      { kind: "subhead", labels: { item: "종류", count: "필요", extra: `여분 ${s.spare}% 포함`, note: "기준" } },
      ...eq.cables.map((c) => ({ kind: "row" as const, cells: { item: c.kind, count: c.count, extra: c.withSpare, note: c.note } })),
    ];
    return items;
  }, [show, library, s.spare]);

  if (error) return <main className="p-6 whitespace-pre-wrap text-red-600">{error}</main>;
  if (show === null)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const exportXlsx = () =>
    downloadBlob(
      `${fileBase(show, "출력물")}.xlsx`,
      new Blob([buildShowXlsx(show, library, inputCols, s.spare) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    );
  const csv = (): string | null => {
    if (s.doc === "inputs") return toCsv(inputCols, inputReportRows(show));
    if (s.doc === "outputs")
      return toCsv(
        [{ key: "section", label: "구분", width: 6 }, ...outputCols],
        outputReportSections(show).flatMap((sec) => sec.rows.map((r) => ({ cells: { ...r.cells, section: sec.title } }))),
      );
    if (s.doc === "summary")
      return toCsv(
        SUMMARY_COLUMNS.map((c) => (c.key === "extra" ? { ...c, label: "부족/여분" } : c)),
        summaryItems.flatMap((it) => (it.kind === "row" ? [{ cells: it.cells }] : it.kind === "section" ? [{ cells: { item: `[${it.title}]` } }] : [])),
      );
    return null;
  };
  const exportCsv = () => {
    const text = csv();
    if (text) downloadText(`${fileBase(show, doc.name)}.csv`, text, "text/csv;charset=utf-8");
  };

  const ctl = "rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700";
  const btn = "rounded border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";
  const num = (v: number, on: (n: number) => void, label: string, min = 0, step = 1) => (
    <label className="flex items-center gap-1">
      {label}
      <input type="number" className={`${ctl} w-20`} value={v} min={min} step={step} onChange={(e) => on(Number(e.target.value) || 0)} />
    </label>
  );
  const colToggles = (cols: ReportColumn[], on: string[], key: "inputCols" | "outputCols") => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-neutral-500">열:</span>
      {cols.map((c) => (
        <label key={c.key} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={on.includes(c.key)}
            onChange={(e) => set({ [key]: e.target.checked ? [...on, c.key] : on.filter((k) => k !== c.key) })}
          />
          {c.label}
        </label>
      ))}
    </div>
  );
  const stripTooWide = s.perStrip * s.cellMm > 277;

  return (
    <div className="min-h-screen bg-neutral-200 dark:bg-neutral-800">
      <style>{`@page { size: A4 ${doc.orientation}; margin: 0; }`}</style>
      <div className="no-print sticky top-0 z-10 space-y-2 border-b border-neutral-300 bg-white/95 p-3 text-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/shows/${show.id}`} className="text-neutral-500 hover:underline">
            ← {show.title} <kbd>Esc</kbd>
          </Link>
          <span className="mx-1 h-4 w-px bg-neutral-300" />
          {DOCS.map((d, i) => (
            <button
              key={d.id}
              onClick={() => set({ doc: d.id })}
              aria-pressed={s.doc === d.id}
              className={`rounded px-2.5 py-1 ${s.doc === d.id ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              title={`${i + 1}`}
            >
              {d.name}
            </button>
          ))}
          <span className="ml-auto" />
          <label className="flex items-center gap-1 text-neutral-500">
            미리보기
            <select className={ctl} value={s.zoom} onChange={(e) => set({ zoom: Number(e.target.value) })}>
              {[0.5, 0.75, 1].map((z) => (
                <option key={z} value={z}>{z * 100}%</option>
              ))}
            </select>
          </label>
          <button className={`${btn} border-blue-500 font-medium text-blue-700 dark:text-blue-300`} onClick={() => window.print()}>
            인쇄 / PDF 저장 <kbd>⌘P</kbd>
          </button>
          <button className={btn} onClick={exportXlsx} title="인풋·아웃풋·박스별 패치·장비 집계를 시트로">
            엑셀 (.xlsx)
          </button>
          <button className={btn} onClick={exportCsv} disabled={!["inputs", "outputs", "summary"].includes(s.doc)} title="지금 보는 표를 CSV로">
            CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {(s.doc === "inputs" || s.doc === "outputs") && (
            <>
              <label className="flex items-center gap-1">
                글자 크기
                <select className={ctl} value={s.fontPt} onChange={(e) => set({ fontPt: Number(e.target.value) })}>
                  {[8, 9, 10, 11, 12].map((p) => (
                    <option key={p} value={p}>{p}pt</option>
                  ))}
                </select>
              </label>
              {s.doc === "inputs" ? colToggles(INPUT_REPORT_COLUMNS, s.inputCols, "inputCols") : colToggles(OUTPUT_REPORT_COLUMNS, s.outputCols, "outputCols")}
            </>
          )}
          {s.doc === "patch" && <span className="text-neutral-500">스테이지박스마다 한 장. 포트 16개씩 세로 칸, 빈 포트도 표시합니다.</span>}
          {s.doc === "summary" && (
            <>
              {num(s.spare, (v) => set({ spare: Math.max(0, v) }), "케이블 여분 %")}
              <span className="text-neutral-500">케이블은 연결 수 기준 추정이며 길이는 세지 않습니다.</span>
            </>
          )}
          {s.doc === "strip" && (
            <>
              {num(s.perStrip, (v) => set({ perStrip: Math.max(1, Math.round(v)) }), "한 줄 채널 수", 1)}
              {num(s.cellMm, (v) => set({ cellMm: Math.max(8, v) }), "채널 폭 mm", 8, 0.5)}
              {num(s.stripMm, (v) => set({ stripMm: Math.max(8, v) }), "높이 mm", 8, 0.5)}
              <span className={stripTooWide ? "font-medium text-red-600" : "text-neutral-500"}>
                {stripTooWide
                  ? `한 줄 폭 ${s.perStrip * s.cellMm}mm가 용지(277mm)를 넘습니다. 채널 수나 폭을 줄이세요.`
                  : "채널 폭은 콘솔 페이더 간격을 자로 재서 넣으세요."}
              </span>
            </>
          )}
          {s.doc === "cable" && (
            <>
              <label className="flex items-center gap-1">
                라벨지
                <select className={ctl} value={s.labelSheet} onChange={(e) => set({ labelSheet: e.target.value })}>
                  {LABEL_SHEETS.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                  <option value="custom">직접 입력…</option>
                </select>
              </label>
              {num(s.startAt, (v) => set({ startAt: Math.max(1, Math.round(v)) }), "시작 칸", 1)}
              {s.labelSheet === "custom" &&
                (
                  [
                    ["cols", "열"],
                    ["rows", "행"],
                    ["width", "칸 폭"],
                    ["height", "칸 높이"],
                    ["top", "위 여백"],
                    ["left", "왼쪽 여백"],
                    ["gapX", "가로 간격"],
                    ["gapY", "세로 간격"],
                  ] as [keyof LabelSheet, string][]
                ).map(([k, label]) => (
                  <span key={k}>{num(s.custom[k] as number, (v) => set({ custom: { ...s.custom, [k]: v } }), label, 0, 0.1)}</span>
                ))}
              <span className="text-neutral-500">라벨지 포장의 치수와 다르면 “직접 입력”으로 맞추고, 일반 종이에 먼저 테스트 인쇄해 겹쳐 보세요.</span>
            </>
          )}
        </div>
        <p className="text-[11px] text-neutral-500">
          인쇄 창에서 대상 “PDF로 저장”, 배율 100%(기본), 여백 “없음” 또는 “기본”을 고르세요. 미리보기의 쪽 구성이 그대로 인쇄됩니다. 숫자 1~6으로 출력물 전환.
        </p>
      </div>

      <div className="print-root overflow-x-auto py-6" style={{ zoom: s.zoom }}>
        {s.doc === "inputs" && (
          <PagedTable show={show} docName="인풋리스트" extra={`${show.inputs.length}ch`} orientation="landscape" columns={inputCols} items={inputItems} fontPt={s.fontPt} printedAt={printedAt} />
        )}
        {s.doc === "outputs" && (
          <PagedTable show={show} docName="아웃풋 리스트" extra={`${show.outputs.length}개 버스`} orientation="landscape" columns={outputCols} items={outputItems} fontPt={s.fontPt} printedAt={printedAt} />
        )}
        {s.doc === "patch" && <PatchSheets show={show} printedAt={printedAt} />}
        {s.doc === "summary" && (
          <PagedTable
            show={show}
            docName="장비 집계표"
            extra={`${show.inputs.length}ch 기준`}
            orientation="portrait"
            columns={SUMMARY_COLUMNS}
            items={summaryItems}
            fontPt={10}
            printedAt={printedAt}
            showHead={false}
          />
        )}
        {s.doc === "strip" && <StripLabels show={show} perStrip={s.perStrip} cellMm={s.cellMm} heightMm={s.stripMm} printedAt={printedAt} />}
        {s.doc === "cable" && <CableLabels show={show} sheet={labelSheet} startAt={s.startAt} />}
      </div>
    </div>
  );
}
