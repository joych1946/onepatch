"use client";

/**
 * 출력 화면: 크루 배포용 출력물 미리보기 + 인쇄(PDF 저장) + 엑셀/CSV.
 * 미리보기의 쪽 구성이 그대로 인쇄된다 (쪽 나누기는 components/print/Paged).
 */
import { useEffect, useMemo, useState } from "react";
import { routes } from "@/lib/routes";
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
  phantomChecklist,
  PHANTOM_CHECK_COLUMNS,
  type LabelSheet,
  type ReportColumn,
} from "@/model/reports";
import { buildShowXlsx, fileBase, toCsv } from "@/lib/showExport";
import { consoleTasks, TASK_SECTIONS } from "@/export/dm7/tasks";
import { DEFAULT_CONSOLE_PROFILE } from "@/export/profile";
import { changedRowIds, contentFingerprint, currentVersion, defaultBase, DIFF_SECTIONS, diffShows, type VersionMeta } from "@/model/versions";
import { getVersionShow, listVersions } from "@/storage/versionStore";
import { downloadBlob, downloadText, escGoesBack, isTypingTarget } from "@/lib/download";
import { useLibrary } from "../useLibrary";
import { localizeShow, type SourceLang } from "@/model/library";
import { PagedTable, type Orientation, type PagedItem } from "./Paged";
import { CableLabels, PatchSheets, StripLabels } from "./Docs";

type Doc = "inputs" | "outputs" | "patch" | "phantom" | "summary" | "cable" | "strip" | "tasks" | "changes";
const DOCS: { id: Doc; name: string; orientation: Orientation }[] = [
  { id: "inputs", name: "인풋리스트", orientation: "landscape" },
  { id: "outputs", name: "아웃풋 리스트", orientation: "landscape" },
  { id: "patch", name: "패치 시트", orientation: "landscape" },
  { id: "phantom", name: "48V 체크리스트", orientation: "portrait" },
  { id: "summary", name: "장비 집계표", orientation: "portrait" },
  { id: "strip", name: "콘솔 스트립 라벨", orientation: "landscape" },
  { id: "cable", name: "멀티케이블 라벨", orientation: "portrait" },
  { id: "tasks", name: "콘솔 할 일", orientation: "portrait" },
  { id: "changes", name: "변경분", orientation: "portrait" },
];

const CHANGE_COLUMNS: ReportColumn[] = [
  { key: "target", label: "대상", width: 24 },
  { key: "kind", label: "구분", width: 7, align: "center" },
  { key: "field", label: "칸", width: 11 },
  { key: "before", label: "이전", width: 29 },
  { key: "after", label: "이후", width: 29 },
];
const KIND_TEXT = { added: "추가", removed: "삭제", changed: "변경" } as const;

const TASK_COLUMNS: ReportColumn[] = [
  { key: "check", label: "✓", width: 4, align: "center" },
  { key: "target", label: "대상", width: 30 },
  { key: "task", label: "할 일", width: 40 },
  { key: "note", label: "참고", width: 26 },
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
  /** 변경분: 이전("auto" = 기준 버전) → 이후("current" = 지금) */
  changesFrom: string;
  changesTo: string;
  /** 인풋·아웃풋 리스트의 바뀐 행 표시 기준 ("auto" | "none" | 버전 id) */
  markBase: string;
  /** 출력물의 소스명: 한글 / 영문 (내 라이브러리에 영문 이름이 있는 소스만 바뀜) */
  sourceLang: SourceLang;
  /** 인쇄할 때 마지막으로 고른 것: 전체 / 선택한 출력물 */
  printMode: "all" | "selected";
  printDocs: Doc[];
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
  changesFrom: "auto",
  changesTo: "current",
  markBase: "auto",
  sourceLang: "ko",
  printMode: "all",
  printDocs: ["inputs", "outputs", "patch"],
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
  const [stored, setShow] = useState<Show | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { library } = useLibrary();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [storedVShows, setVShows] = useState<Record<string, Show>>({});
  /** 인쇄 중인 출력물들 (null = 미리보기는 고른 출력물 하나) */
  const [printing, setPrinting] = useState<Doc[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [printedAt] = useState(() => new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }));

  useEffect(() => {
    getShow(id).then(setShow, (e) => setError(String(e)));
    listVersions(id).then(setVersions, () => setVersions([]));
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

  // 고른 출력물들을 정해진 순서로 한꺼번에 그린 뒤 인쇄 창을 연다. 인쇄 창을 닫으면 미리보기로.
  useEffect(() => {
    if (!printing) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPrinting(null);
    };
    window.addEventListener("afterprint", finish);
    // 쪽 나누기(행 높이 재기)가 끝나도록 몇 프레임 기다린다
    const t = window.setTimeout(() => {
      window.print();
      window.setTimeout(finish, 500);
    }, 400);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", finish);
    };
  }, [printing]);
  const startPrint = (docs: Doc[]) => {
    setAsking(false);
    setPrinting(DOCS.map((d) => d.id).filter((id) => docs.includes(id)));
  };

  // 출력물은 고른 언어의 소스명으로 (버전도 같은 기준으로 바꿔야 변경분에 가짜 변경이 생기지 않는다)
  const show = useMemo(() => (stored && library ? localizeShow(stored, library, s.sourceLang) : stored), [stored, library, s.sourceLang]);
  const vShows = useMemo(
    () => (library ? Object.fromEntries(Object.entries(storedVShows).map(([k, v]) => [k, localizeShow(v, library, s.sourceLang)])) : storedVShows),
    [storedVShows, library, s.sourceLang],
  );

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
      // ⌘P / Ctrl+P: 브라우저 인쇄 대신 "무엇을 출력할지" 먼저 묻기
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setAsking(true);
        return;
      }
      if (e.defaultPrevented || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Esc: Show 화면으로 돌아가기 (Show 화면에서 P로 들어온 것의 반대)
      if (e.key === "Escape") {
        if (!escGoesBack(e)) return;
        e.preventDefault();
        router.push(routes.show(id));
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

  /* 버전: 머리말의 버전 줄, 바뀐 행 표시, 변경분 */
  const fp = useMemo(() => (stored ? contentFingerprint(stored) : ""), [stored]);
  const resolveId = (v: string, auto: () => VersionMeta | null) => (v === "auto" ? (auto()?.id ?? null) : v === "none" || v === "current" ? v : versions.some((x) => x.id === v) ? v : null);
  const markId = resolveId(s.markBase, () => defaultBase(versions, fp));
  const fromId = resolveId(s.changesFrom, () => defaultBase(versions, fp));
  const toId = s.changesTo === "current" || !versions.some((v) => v.id === s.changesTo) ? "current" : s.changesTo;
  useEffect(() => {
    for (const v of [markId, fromId, toId]) if (v && v !== "none" && v !== "current" && !vShows[v]) void getVersionShow(v).then((x) => setVShows((m) => ({ ...m, [v]: x })));
  }, [markId, fromId, toId, vShows]);
  const vName = (v: string | null) => {
    if (v !== "current") return versions.find((x) => x.id === v)?.name ?? "—";
    const same = currentVersion(versions, fp);
    return same ? `${same.name} (지금)` : "지금";
  };
  const vDate = (v: VersionMeta) => new Date(v.createdAt).toLocaleDateString("ko-KR");
  const marked = useMemo(() => (show && markId && markId !== "none" && vShows[markId] ? changedRowIds(diffShows(vShows[markId], show)) : null), [show, markId, vShows]);
  const cur = currentVersion(versions, fp);
  const versionNote = (withMarks: boolean) => {
    if (!show || !versions.length) return undefined;
    const head = cur ? `버전 ${cur.name} · ${vDate(cur)} 저장` : `버전 ${show.version || "—"} · 마지막 저장 “${versions[0].name}”(${vDate(versions[0])}) 이후 수정됨`;
    return withMarks && marked ? `${head} · ▲ = “${vName(markId)}” 이후 바뀐 행 ${marked.size}개` : head;
  };

  const inputItems = useMemo<PagedItem[]>(
    () => (show ? inputReportRows(show).map((r) => ({ kind: "row", cells: r.cells, color: r.color, mark: !!marked?.has(r.id!) })) : []),
    [show, marked],
  );
  const outputItems = useMemo<PagedItem[]>(
    () =>
      show
        ? outputReportSections(show).flatMap((sec) => [{ kind: "section" as const, title: sec.title }, ...sec.rows.map((r) => ({ kind: "row" as const, cells: r.cells, mark: !!marked?.has(r.id!) }))])
        : [],
    [show, marked],
  );
  const changeDiff = useMemo(() => {
    if (!show || !fromId || fromId === "none") return null;
    const a = fromId === "current" ? show : vShows[fromId];
    const b = toId === "current" ? show : vShows[toId];
    return a && b ? diffShows(a, b) : null;
  }, [show, fromId, toId, vShows]);
  const changeItems = useMemo<PagedItem[]>(() => {
    if (!changeDiff) return [];
    const rows: PagedItem[] = [];
    if (changeDiff.info.length) {
      rows.push({ kind: "section", title: "공연 정보" });
      for (const f of changeDiff.info) rows.push({ kind: "row", cells: { target: "", kind: "변경", field: f.field, before: f.before, after: f.after } });
    }
    for (const { key, title } of DIFF_SECTIONS) {
      if (!changeDiff[key].length) continue;
      rows.push({ kind: "section", title: `${title} (${changeDiff[key].length})` });
      for (const r of changeDiff[key]) {
        if (!r.fields.length) rows.push({ kind: "row", cells: { target: r.label, kind: KIND_TEXT[r.kind], field: "", before: "", after: "" } });
        r.fields.forEach((f, i) => rows.push({ kind: "row", cells: { target: i === 0 ? r.label : "", kind: i === 0 ? KIND_TEXT[r.kind] : "", field: f.field, before: f.before, after: f.after } }));
      }
    }
    return rows;
  }, [changeDiff]);
  const phantomItems = useMemo<PagedItem[]>(() => {
    if (!show) return [];
    const { on, never } = phantomChecklist(show);
    const rows = (list: typeof on) => list.map((r) => ({ kind: "row" as const, cells: r.cells, color: r.color }));
    return [
      { kind: "section", title: `48V 켜기 — ${on.length}채널 (마이크·DI를 꽂은 뒤, 포트 순서)` },
      ...(on.length ? rows(on) : [{ kind: "row" as const, cells: { source: "48V가 필요한 채널이 없습니다." } }]),
      ...(never.length ? [{ kind: "section" as const, title: `48V 걸면 안 됨 — ${never.length}채널 (리본 등)` }, ...rows(never)] : []),
    ];
  }, [show]);
  const taskItems = useMemo<PagedItem[]>(() => {
    if (!show) return [];
    const tasks = consoleTasks(show, DEFAULT_CONSOLE_PROFILE);
    return TASK_SECTIONS.flatMap((sec) => {
      const list = tasks.filter((t) => t.section === sec);
      return list.length
        ? [{ kind: "section" as const, title: sec }, ...list.map((t) => ({ kind: "row" as const, cells: { check: "☐", target: t.target, task: t.task, note: t.note ?? "" } }))]
        : [];
    });
  }, [show]);

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
      { kind: "section", title: "무선 채널" },
      { kind: "subhead", labels: { item: "종류", count: "채널 수", note: "채널" } },
      { kind: "row", cells: { item: "핸드헬드", count: eq.wireless.handheld } },
      { kind: "row", cells: { item: "바디팩 (헤드셋·라벨리어·악기)", count: eq.wireless.bodypack } },
      { kind: "row", cells: { item: "합계 (수신기 채널)", count: eq.wireless.total, note: eq.wireless.channels.join(", ") } },
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

  /** 출력물 하나의 내용 (미리보기·인쇄 공통) */
  const docBody = (d: Doc) => (
    <>
        {d === "inputs" && (
          <PagedTable show={show} docName="인풋리스트" extra={`${show.inputs.length}ch`} orientation="landscape" columns={inputCols} items={inputItems} fontPt={s.fontPt} printedAt={printedAt} note={versionNote(true)} />
        )}
        {d === "outputs" && (
          <PagedTable show={show} docName="아웃풋 리스트" extra={`${show.outputs.length}개 버스`} orientation="landscape" columns={outputCols} items={outputItems} fontPt={s.fontPt} printedAt={printedAt} note={versionNote(true)} />
        )}
        {d === "patch" && <PatchSheets show={show} printedAt={printedAt} />}
        {d === "phantom" && (
          <PagedTable
            show={show}
            docName="48V 체크리스트"
            extra="팬텀이 필요한 채널만"
            orientation="portrait"
            columns={PHANTOM_CHECK_COLUMNS}
            items={phantomItems}
            fontPt={10}
            printedAt={printedAt}
          />
        )}
        {d === "summary" && (
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
        {d === "strip" && <StripLabels show={show} perStrip={s.perStrip} cellMm={s.cellMm} heightMm={s.stripMm} printedAt={printedAt} />}
        {d === "cable" && <CableLabels show={show} sheet={labelSheet} startAt={s.startAt} />}
        {d === "changes" &&
          (changeDiff ? (
            <PagedTable
              show={show}
              docName="변경분"
              extra={`${vName(fromId)} → ${vName(toId)} · ${changeDiff.total}건`}
              orientation="portrait"
              columns={CHANGE_COLUMNS}
              items={changeItems.length ? changeItems : [{ kind: "row", cells: { target: "바뀐 것이 없습니다." } }]}
              fontPt={9}
              printedAt={printedAt}
              note={versionNote(false)}
            />
          ) : (
            <p className="no-print p-6 text-center text-neutral-500">{versions.length ? "버전 내용을 읽는 중…" : "저장한 버전이 없습니다."}</p>
          ))}
        {d === "tasks" && (
          <PagedTable
            show={show}
            docName="콘솔 할 일"
            extra={DEFAULT_CONSOLE_PROFILE.name}
            orientation="portrait"
            columns={TASK_COLUMNS}
            items={taskItems}
            fontPt={9}
            printedAt={printedAt}
          />
        )}
    </>
  );

  return (
    <div className="min-h-screen bg-neutral-200 dark:bg-neutral-800">
      <style>{`@page { size: A4 ${printing ? DOCS.find((d) => d.id === printing[0])?.orientation ?? "portrait" : doc.orientation}; margin: 0; }`}</style>
      {asking && (
        <PrintAsk
          mode={s.printMode}
          docs={s.printDocs}
          current={s.doc}
          onCancel={() => setAsking(false)}
          onPrint={(mode, docs) => {
            set({ printMode: mode, printDocs: mode === "selected" ? docs : s.printDocs });
            startPrint(mode === "all" ? DOCS.map((d) => d.id) : docs);
          }}
        />
      )}
      <div className="no-print sticky top-0 z-10 space-y-2 border-b border-neutral-300 bg-white/95 p-3 text-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={routes.show(show.id)} className="text-neutral-500 hover:underline">
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
          <label className="flex items-center gap-1 text-neutral-500" title="내 라이브러리에 영문 이름이 있는 소스(국악기 등)만 바뀝니다">
            소스명
            <select className={ctl} value={s.sourceLang} onChange={(e) => set({ sourceLang: e.target.value as SourceLang })} aria-label="출력물 소스명 언어">
              <option value="ko">한글</option>
              <option value="en">영문</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-neutral-500">
            미리보기
            <select className={ctl} value={s.zoom} onChange={(e) => set({ zoom: Number(e.target.value) })}>
              {[0.5, 0.75, 1].map((z) => (
                <option key={z} value={z}>{z * 100}%</option>
              ))}
            </select>
          </label>
          <button className={`${btn} border-blue-500 font-medium text-blue-700 dark:text-blue-300`} onClick={() => setAsking(true)}>
            인쇄 / PDF 저장… <kbd>⌘P</kbd>
          </button>
          <button className={btn} onClick={exportXlsx} title="인풋·아웃풋·박스별 패치·장비 집계를 시트로">
            엑셀 (.xlsx)
          </button>
          <button className={btn} onClick={exportCsv} disabled={!["inputs", "outputs", "summary"].includes(s.doc)} title="지금 보는 표를 CSV로">
            CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {(s.doc === "inputs" || s.doc === "outputs") && versions.length > 0 && (
            <label className="flex items-center gap-1">
              ▲ 바뀐 행 표시
              <select className={ctl} value={s.markBase} onChange={(e) => set({ markBase: e.target.value })} aria-label="바뀐 행 표시 기준">
                <option value="auto">자동 ({defaultBase(versions, fp)?.name ?? "없음"} 이후)</option>
                <option value="none">표시 안 함</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} 이후
                  </option>
                ))}
              </select>
            </label>
          )}
          {s.doc === "changes" && (
            <>
              <label className="flex items-center gap-1">
                이전
                <select className={ctl} value={s.changesFrom} onChange={(e) => set({ changesFrom: e.target.value })} aria-label="변경분 이전">
                  <option value="auto">자동 ({defaultBase(versions, fp)?.name ?? "버전 없음"})</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                이후
                <select className={ctl} value={toId} onChange={(e) => set({ changesTo: e.target.value })} aria-label="변경분 이후">
                  <option value="current">지금</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              {!versions.length && <span className="text-neutral-500">저장한 버전이 없습니다. Show 화면의 “버전 저장”(V)으로 먼저 남기세요.</span>}
            </>
          )}
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
          {s.doc === "tasks" && (
            <span className="text-neutral-500">
              {DEFAULT_CONSOLE_PROFILE.name} 쇼 파일로 넣지 못하는 것(게인·EQ, 버스 스테레오 설정, Aux Pre/Post, Matrix 소스 등)을 이 Show에 맞춰 뽑은 체크리스트입니다.
            </span>
          )}
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
          인쇄 창에서 대상 “PDF로 저장”, 배율 100%(기본), 여백 “없음” 또는 “기본”을 고르세요. 미리보기의 쪽 구성이 그대로 인쇄됩니다. 숫자 1~9로 출력물 전환.
        </p>
      </div>

      <div className="print-root overflow-x-auto py-6" style={{ zoom: s.zoom }}>
        {/* 인쇄 중에는 고른 출력물 모두. 변경분은 비교할 버전이 있을 때만 (빈 쪽이 나오지 않게) */}
        {(printing ? printing.filter((d) => d !== "changes" || changeDiff) : [s.doc]).map((d) => (
          <div key={d} className="print-doc">
            {docBody(d)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 인쇄를 누르면 먼저 묻기: 전체 출력 / 선택한 출력물만 (마지막 선택을 기억) */
function PrintAsk({
  mode: mode0,
  docs: docs0,
  current,
  onCancel,
  onPrint,
}: {
  mode: "all" | "selected";
  docs: Doc[];
  current: Doc;
  onCancel: () => void;
  onPrint: (mode: "all" | "selected", docs: Doc[]) => void;
}) {
  const [mode, setMode] = useState(mode0);
  const [docs, setDocs] = useState<Doc[]>(docs0.length ? docs0 : [current]);
  const ok = mode === "all" || docs.length > 0;
  const radio = "flex cursor-pointer items-start gap-2 rounded-lg border p-3";
  return (
    <div
      className="no-print fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && ok) {
          e.preventDefault();
          onPrint(mode, docs);
        }
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="무엇을 출력할까요"
        className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-white p-5 text-sm shadow-2xl sm:inset-x-auto sm:top-16 sm:bottom-auto sm:left-1/2 sm:w-[520px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900"
      >
        <h2 className="text-base font-semibold">무엇을 출력할까요?</h2>
        <label className={`${radio} ${mode === "all" ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-neutral-300 dark:border-neutral-700"}`}>
          <input type="radio" name="print-mode" checked={mode === "all"} onChange={() => setMode("all")} autoFocus={mode0 === "all"} />
          <span>
            <b>전체 출력</b>
            <span className="block text-xs text-neutral-500">{DOCS.map((d) => d.name).join(" → ")} 순서로 한 번에</span>
          </span>
        </label>
        <label className={`${radio} ${mode === "selected" ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-neutral-300 dark:border-neutral-700"}`}>
          <input type="radio" name="print-mode" checked={mode === "selected"} onChange={() => setMode("selected")} autoFocus={mode0 === "selected"} />
          <span className="flex-1">
            <b>선택한 출력물만</b>
            <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {DOCS.map((d) => (
                <span key={d.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    aria-label={d.name}
                    checked={docs.includes(d.id)}
                    onChange={(e) => {
                      setMode("selected");
                      setDocs((cur) => (e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id)));
                    }}
                  />
                  {d.name}
                </span>
              ))}
            </span>
          </span>
        </label>
        <p className="text-xs text-neutral-500">인쇄 창에서 “PDF로 저장”을 고르면 한 파일로 저장됩니다. 저장한 버전이 없으면 변경분은 빠집니다.</p>
        <div className="flex justify-end gap-2">
          <button className="rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700" onClick={onCancel}>
            취소 <kbd>Esc</kbd>
          </button>
          <button
            className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-40"
            disabled={!ok}
            onClick={() => onPrint(mode, docs)}
          >
            인쇄 <kbd>Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
