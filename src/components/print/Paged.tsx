"use client";

/**
 * A4 쪽 나누기. 화면 미리보기와 인쇄가 같은 쪽 구성을 갖도록 브라우저에 맡기지 않고 직접 나눈다.
 * 보이지 않는 곳에 표를 한 번 그려 행 높이를 재고(줄바꿈 포함), 쪽 높이에 맞게 행 단위로 나눈다.
 * → 행이 쪽 경계에서 잘리지 않고, 채널이 많으면 자연스럽게 다음 쪽으로 넘어간다.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COLOR_LABEL, COLOR_SWATCH } from "@/model/labels";
import type { Color, Show } from "@/model/schema";
import type { Cell, ReportColumn } from "@/model/reports";

export type Orientation = "landscape" | "portrait";
export const PAGE_MM = { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } };
export const MARGIN_MM = 10;
const FOOTER_MM = 6;
const PX_PER_MM = 96 / 25.4;

/* ───────────── 쪽 틀 ───────────── */

export function Sheet({ orientation, children, className = "" }: { orientation: Orientation; children: ReactNode; className?: string }) {
  const { w, h } = PAGE_MM[orientation];
  return (
    <div className={`sheet ${className}`} style={{ width: `${w}mm`, height: `${h}mm`, padding: `${MARGIN_MM}mm` }}>
      {children}
    </div>
  );
}

/** note: 버전 줄 (버전 이름·저장 날짜, 바뀐 행 표시 기준) — 없으면 Show의 버전 칸 */
export function PageHeader({ show, docName, extra, note }: { show: Show; docName: string; extra?: string; note?: string }) {
  const meta = [show.date, show.venue, !note && show.version && `버전 ${show.version}`, show.author && `작성 ${show.author}`].filter(Boolean).join(" · ");
  return (
    <div className="mb-[2.5mm] flex items-end gap-[4mm] border-b-[0.5mm] border-black pb-[1.5mm]" data-m="header">
      <div className="min-w-0 flex-1">
        <div className="text-[14pt] leading-tight font-bold">{show.title}</div>
        <div className="text-[8.5pt] leading-tight text-neutral-700">{meta}</div>
        {note && <div className="text-[8.5pt] leading-tight font-medium">{note}</div>}
      </div>
      <div className="text-right">
        <div className="text-[12pt] leading-tight font-bold">{docName}</div>
        {extra && <div className="text-[8pt] leading-tight text-neutral-700">{extra}</div>}
      </div>
    </div>
  );
}

export function PageFooter({ page, pages, printedAt }: { page: number; pages: number; printedAt: string }) {
  return (
    <div className="absolute right-[10mm] bottom-[4mm] left-[10mm] flex justify-between text-[7.5pt] text-neutral-600">
      <span>OnePatch · 출력 {printedAt}</span>
      <span>
        {page} / {pages}
      </span>
    </div>
  );
}

/* ───────────── 표 쪽 나누기 ───────────── */

export type PagedItem =
  | { kind: "row"; cells: Record<string, Cell>; color?: Color; /** 이전 버전에서 바뀐 행 */ mark?: boolean }
  /** 구역 제목 (아웃풋의 Aux/Matrix/Main, 집계표의 항목) — 다음 행과 함께 다닌다 */
  | { kind: "section"; title: string }
  /** 구역 안의 머리글 (집계표처럼 구역마다 열 이름이 다를 때) */
  | { kind: "subhead"; labels: Record<string, string> };

export function ColorChip({ color }: { color?: Color }) {
  if (!color || color === "none") return null;
  return (
    <span className="inline-flex items-center gap-[1mm]">
      <span className="inline-block h-[2.6mm] w-[2.6mm] shrink-0 border border-black" style={{ background: COLOR_SWATCH[color] }} />
      {COLOR_LABEL[color]}
    </span>
  );
}

function Rows({ items, columns }: { items: PagedItem[]; columns: ReportColumn[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === "section")
          return (
            <tr key={i} className="section">
              <td colSpan={columns.length}>{it.title}</td>
            </tr>
          );
        if (it.kind === "subhead")
          return (
            <tr key={i} className="subhead">
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                  {it.labels[c.key] ?? ""}
                </td>
              ))}
            </tr>
          );
        return (
          <tr key={i} className={it.mark ? "changed" : undefined}>
            {columns.map((c, ci) => (
              <td key={c.key} style={{ textAlign: c.align ?? "left" }} className={ci === 0 ? "first" : undefined}>
                {ci === 0 && it.color && it.color !== "none" && <span className="rowcolor" style={{ background: COLOR_SWATCH[it.color] }} />}
                {ci === 0 && it.mark && <span className="mark">▲</span>}
                {c.key === "color" ? <ColorChip color={it.color} /> : it.cells[c.key]}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

function Table({ columns, items, fontPt, showHead }: { columns: ReportColumn[]; items: PagedItem[]; fontPt: number; showHead: boolean }) {
  const total = columns.reduce((s, c) => s + c.width, 0);
  return (
    <table className="report" style={{ fontSize: `${fontPt}pt` }}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: `${(c.width / total) * 100}%` }} />
        ))}
      </colgroup>
      {showHead && (
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? "left" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        <Rows items={items} columns={columns} />
      </tbody>
    </table>
  );
}

/**
 * 표를 A4 쪽으로 나눠 그린다. 모든 쪽에 머리말과 열 머리글이 반복된다.
 */
export function PagedTable({
  show,
  docName,
  extra,
  orientation,
  columns,
  items,
  fontPt,
  printedAt,
  showHead = true,
  note,
}: {
  show: Show;
  docName: string;
  extra?: string;
  orientation: Orientation;
  columns: ReportColumn[];
  items: PagedItem[];
  fontPt: number;
  printedAt: string;
  showHead?: boolean;
  note?: string;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PagedItem[][] | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const { w, h } = PAGE_MM[orientation];

  useLayoutEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const signature = useMemo(() => JSON.stringify([columns.map((c) => c.key), items, fontPt, orientation, fontsReady]), [columns, items, fontPt, orientation, fontsReady]);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // 미리보기 배율(zoom) 아래에서 재더라도 실제 mm로 환산
    const scale = el.getBoundingClientRect().width / ((w - 2 * MARGIN_MM) * PX_PER_MM) || 1;
    const mm = (node: Element | null) => (node ? node.getBoundingClientRect().height / PX_PER_MM / scale : 0);
    const headerH = mm(el.querySelector("[data-m=header]")) + 2.5;
    const theadH = mm(el.querySelector("thead"));
    const rowH = [...el.querySelectorAll("tbody > tr")].map((tr) => mm(tr));
    // 여유 1mm: 화면과 인쇄의 반올림 차이
    const avail = h - 2 * MARGIN_MM - FOOTER_MM - headerH - theadH - 1;
    const out: PagedItem[][] = [];
    let cur: PagedItem[] = [];
    let used = 0;
    items.forEach((it, i) => {
      // 구역 제목·머리글은 다음 데이터 행과 함께 넘어간다
      let need = rowH[i];
      if (it.kind !== "row") {
        for (let j = i + 1; j < items.length; j++) {
          need += rowH[j];
          if (items[j].kind === "row") break;
        }
      }
      if (cur.length && used + need > avail) {
        out.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(it);
      used += rowH[i];
    });
    if (cur.length || !out.length) out.push(cur);
    setPages(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <>
      {/* 재기용 (보이지 않음) */}
      <div aria-hidden className="measure" style={{ width: `${w - 2 * MARGIN_MM}mm` }} ref={measureRef}>
        <PageHeader show={show} docName={docName} extra={extra} note={note} />
        <Table columns={columns} items={items} fontPt={fontPt} showHead={showHead} />
      </div>
      {pages?.map((p, i) => (
        <Sheet key={i} orientation={orientation}>
          <PageHeader show={show} docName={docName} extra={extra} note={note} />
          <Table columns={columns} items={p} fontPt={fontPt} showHead={showHead} />
          <PageFooter page={i + 1} pages={pages.length} printedAt={printedAt} />
        </Sheet>
      ))}
    </>
  );
}
