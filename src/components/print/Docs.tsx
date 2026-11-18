"use client";

/** 고정 배치 출력물: 패치 시트, 멀티케이블 라벨, 콘솔 스트립 라벨 (칸 크기가 정해져 있어 잴 필요가 없다) */
import { COLOR_LABEL, COLOR_SWATCH } from "@/model/labels";
import { channelLabels, PATCH_ROWS_PER_COLUMN, patchSheet, type LabelSheet, type PatchSlot } from "@/model/reports";
import type { Show } from "@/model/schema";
import { MARGIN_MM, PAGE_MM, PageFooter, PageHeader, Sheet } from "./Paged";

const chunk = <T,>(list: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

/* ───────────── 패치 시트 ───────────── */

const HEADER_MM = 17;
const COLHEAD_MM = 8;
const COLS_PER_PAGE = 3;

/**
 * 스테이지박스마다 A4 가로 한 장(포트가 많으면 여러 장). 포트 16개씩 세로 칸,
 * 큰 글씨로 채널 번호와 이름, 작은 글씨로 소스·마이크·48V·스탠드.
 */
export function PatchSheets({ show, printedAt }: { show: Show; printedAt: string }) {
  type Col = { title: string; slots: PatchSlot[]; dir: "in" | "out" };
  const pages: { box: string; location: string; cols: Col[] }[] = [];
  for (const box of show.stageBoxes) {
    const { ins, outs } = patchSheet(show, box.id);
    const cols: Col[] = [
      ...chunk(ins, PATCH_ROWS_PER_COLUMN).map((s) => ({ title: `인풋 ${s[0].port}–${s[s.length - 1].port}`, slots: s, dir: "in" as const })),
      ...chunk(outs, PATCH_ROWS_PER_COLUMN).map((s) => ({ title: `아웃풋 ${s[0].port}–${s[s.length - 1].port}`, slots: s, dir: "out" as const })),
    ];
    chunk(cols, COLS_PER_PAGE).forEach((c) => pages.push({ box: box.name, location: box.location, cols: c }));
  }
  const avail = PAGE_MM.landscape.h - 2 * MARGIN_MM - HEADER_MM - COLHEAD_MM - 6;
  const rowMm = avail / PATCH_ROWS_PER_COLUMN;
  return (
    <>
      {pages.map((p, i) => (
        <Sheet key={i} orientation="landscape">
          <PageHeader show={show} docName={`패치 시트 — ${p.box}`} extra={p.location} />
          <div className="flex gap-[4mm]">
            {p.cols.map((col, ci) => (
              <div key={ci} className="min-w-0 flex-1">
                <div className="mb-[1mm] flex h-[7mm] items-center border-b-[0.6mm] border-black text-[12pt] font-bold">
                  {col.dir === "in" ? "▶ " : "◀ "}
                  {col.title}
                </div>
                {col.slots.map((s) => (
                  <div
                    key={s.port}
                    className={`patchslot ${col.dir} ${s.conflict ? "conflict" : ""} ${s.main ? "" : "empty"}`}
                    style={{ height: `${rowMm}mm` }}
                  >
                    <span className="port">{s.port}</span>
                    {s.color && s.color !== "none" && <span className="bar" style={{ background: COLOR_SWATCH[s.color] }} title={COLOR_LABEL[s.color]} />}
                    <span className="main">{s.main || "—"}</span>
                    <span className="text">
                      <span className="name">{s.name}</span>
                      <span className="detail">{s.conflict ? "⚠ 확인 필요 · " : ""}{s.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <PageFooter page={i + 1} pages={pages.length} printedAt={printedAt} />
        </Sheet>
      ))}
    </>
  );
}

/* ───────────── 멀티케이블 라벨 ───────────── */

export function CableLabels({ show, sheet, startAt }: { show: Show; sheet: LabelSheet; startAt: number }) {
  const per = sheet.cols * sheet.rows;
  const blanks = Math.max(0, Math.min(per - 1, startAt - 1));
  const labels = [...Array<null>(blanks).fill(null), ...channelLabels(show)];
  const pages = chunk(labels, per);
  const big = Math.min(sheet.height * 0.55, sheet.width * 0.32); // mm
  return (
    <>
      {pages.map((page, pi) => (
        <div key={pi} className="sheet" style={{ width: "210mm", height: "297mm", padding: 0 }}>
          {page.map((l, i) => {
            const col = i % sheet.cols;
            const row = Math.floor(i / sheet.cols);
            if (!l) return null;
            return (
              <div
                key={i}
                className="cablelabel"
                style={{
                  left: `${sheet.left + col * (sheet.width + sheet.gapX)}mm`,
                  top: `${sheet.top + row * (sheet.height + sheet.gapY)}mm`,
                  width: `${sheet.width}mm`,
                  height: `${sheet.height}mm`,
                }}
              >
                <span className="num" style={{ fontSize: `${big}mm`, minWidth: `${big * 1.5}mm` }}>
                  {l.ch}
                </span>
                <span className="body">
                  <span className="name" style={{ fontSize: `${Math.min(big * 0.55, 5)}mm` }}>
                    {l.name}
                  </span>
                  {sheet.height >= 25 && <span className="small">{l.source !== l.name ? l.source : ""}</span>}
                  <span className="small">{l.port}</span>
                  {l.color !== "none" && (
                    <span className="small">
                      <span className="sw" style={{ background: COLOR_SWATCH[l.color] }} />
                      {COLOR_LABEL[l.color]}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/* ───────────── 콘솔 스트립 라벨 ───────────── */

export function StripLabels({
  show,
  perStrip,
  cellMm,
  heightMm,
  printedAt,
}: {
  show: Show;
  perStrip: number;
  cellMm: number;
  heightMm: number;
  printedAt: string;
}) {
  const strips = chunk(channelLabels(show), perStrip);
  const gap = 4;
  const usable = PAGE_MM.landscape.h - 2 * MARGIN_MM - HEADER_MM - 6;
  const perPage = Math.max(1, Math.floor((usable + gap) / (heightMm + gap)));
  const pages = chunk(strips, perPage);
  return (
    <>
      {pages.map((p, pi) => (
        <Sheet key={pi} orientation="landscape">
          <PageHeader show={show} docName="콘솔 스트립 라벨" extra={`채널 폭 ${cellMm}mm · 높이 ${heightMm}mm — 점선을 따라 자르세요`} />
          <div className="flex flex-col" style={{ gap: `${gap}mm` }}>
            {p.map((strip, si) => (
              <div key={si} className="strip" style={{ height: `${heightMm}mm` }}>
                {strip.map((l) => (
                  <div key={l.ch} className="stripcell" style={{ width: `${cellMm}mm` }}>
                    <span className="ch">{l.ch}</span>
                    <span className="nm" style={{ fontSize: `${Math.min(heightMm * 0.42, cellMm / Math.max(4, [...l.name].length) * 1.6)}mm` }}>
                      {l.name}
                    </span>
                    {l.color !== "none" && (
                      <span className="cb" style={{ background: COLOR_SWATCH[l.color] }}>
                        <span>{COLOR_LABEL[l.color]}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <PageFooter page={pi + 1} pages={pages.length} printedAt={printedAt} />
        </Sheet>
      ))}
    </>
  );
}
