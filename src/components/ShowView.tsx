"use client";

/** Show 읽기 전용 보기 (편집 화면은 다음 단계) + JSON 내보내기 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Show } from "@/model/schema";
import { showFileName, showToJson } from "@/model/serialize";
import { micName, resolvePhantom, resolveStand, SHORT_NAME_WARN_LENGTH } from "@/model/derive";
import {
  BUS_KIND_LABEL,
  BUS_PURPOSE_LABEL,
  COLOR_SWATCH,
  MIC_TYPE_LABEL,
  formatPort,
} from "@/model/labels";
import { getShow } from "@/storage/showStore";
import { downloadText, isTypingTarget } from "@/lib/download";

const th = "py-1.5 pr-3 text-left font-medium text-neutral-500 whitespace-nowrap";
const td = "py-1 pr-3 align-top";

export default function ShowView({ id }: { id: string }) {
  const router = useRouter();
  const [show, setShow] = useState<Show | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getShow(id).then(setShow, (e) => setError(String(e)));
  }, [id]);

  const exportJson = () => show && downloadText(showFileName(show), showToJson(show));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") router.push("/");
      else if (e.key === "e") exportJson();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <main className="p-6 text-red-600 whitespace-pre-wrap">{error}</main>;
  if (show === undefined) return <main className="p-6 text-neutral-500">불러오는 중…</main>;
  if (show === null)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );

  const dcaName = (dcaId: string) => show.dcas.find((d) => d.id === dcaId)?.number ?? "?";
  const mgName = (mgId: string) => show.muteGroups.find((g) => g.id === mgId)?.number ?? "?";
  const btn =
    "rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800";

  return (
    <main className="mx-auto w-full max-w-7xl p-6 text-sm">
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <Link href="/" className="text-neutral-500 hover:underline">
            ← 목록 <kbd>Esc</kbd>
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{show.title}</h1>
          <p className="text-neutral-500">
            {[show.date, show.venue, show.author && `작성 ${show.author}`, show.version]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {show.notes && <p className="mt-1">{show.notes}</p>}
        </div>
        <button className={btn} onClick={exportJson}>
          JSON 내보내기 <kbd>E</kbd>
        </button>
      </header>

      <Section title={`인풋 (${show.inputs.length}ch)`}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              {["Ch", "", "소스", "짧은 이름", "파트", "마이크/DI", "스탠드", "48V", "포트", "Link", "DCA", "Mute", "비고"].map(
                (h, i) => (
                  <th key={i} className={th}>{h}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {[...show.inputs]
              .sort((a, b) => a.number - b.number)
              .map((ch) => (
                <tr key={ch.id} className="border-b border-neutral-200 dark:border-neutral-800">
                  <td className={`${td} tabular-nums`}>{ch.number}</td>
                  <td className={td}>
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-neutral-400"
                      style={{ background: COLOR_SWATCH[ch.color] }}
                    />
                  </td>
                  <td className={td}>{ch.source}</td>
                  <td
                    className={`${td} font-mono ${
                      ch.shortName.length > SHORT_NAME_WARN_LENGTH ? "text-amber-600" : ""
                    }`}
                    title={
                      ch.shortName.length > SHORT_NAME_WARN_LENGTH
                        ? `${SHORT_NAME_WARN_LENGTH}자 초과 — 콘솔에서 잘릴 수 있음`
                        : undefined
                    }
                  >
                    {ch.shortName}
                  </td>
                  <td className={td}>{ch.performer}</td>
                  <td className={td}>{micName(show, ch)}</td>
                  <td className={td}>{resolveStand(show, ch) || "—"}</td>
                  <td className={`${td} font-semibold text-red-600`}>
                    {resolvePhantom(show, ch) ? "48V" : ""}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatPort(ch.port, show.stageBoxes)}</td>
                  <td className={td}>{ch.stereoLinkNext ? `↔${ch.number + 1}` : ""}</td>
                  <td className={td}>{ch.dcaIds.map(dcaName).join(",")}</td>
                  <td className={td}>{ch.muteGroupIds.map(mgName).join(",")}</td>
                  <td className={td}>{ch.notes}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Section>

      <Section title={`아웃풋 (${show.outputs.length})`}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 dark:border-neutral-700">
              {["버스", "이름", "용도", "M/S", "Pre/Post", "물리 출력", "비고"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {show.outputs.map((b) => (
              <tr key={b.id} className="border-b border-neutral-200 dark:border-neutral-800">
                <td className={`${td} whitespace-nowrap`}>
                  {BUS_KIND_LABEL[b.kind]} {b.number}
                </td>
                <td className={td}>{b.name}</td>
                <td className={td}>{BUS_PURPOSE_LABEL[b.purpose]}</td>
                <td className={td}>{b.width === "stereo" ? "Stereo" : "Mono"}</td>
                <td className={td}>{b.kind === "main" ? "" : b.tap === "pre" ? "Pre" : "Post"}</td>
                <td className={td}>
                  {b.ports.length ? b.ports.map((p) => formatPort(p, show.stageBoxes)).join(" / ") : "—"}
                </td>
                <td className={td}>{b.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid gap-6 md:grid-cols-3">
        <Section title="스테이지박스">
          <ul className="space-y-1">
            {show.stageBoxes.map((b) => (
              <li key={b.id}>
                <b>{b.name}</b> {b.inputs}in/{b.outputs}out
                <span className="text-neutral-500"> · {b.location}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="DCA / 뮤트 그룹">
          <ul className="space-y-1">
            {show.dcas.map((d) => (
              <li key={d.id}>DCA {d.number} — {d.name}</li>
            ))}
            {show.muteGroups.map((g) => (
              <li key={g.id}>Mute {g.number} — {g.name}</li>
            ))}
          </ul>
        </Section>
        <Section title={`마이크 라이브러리 (${show.microphones.length})`}>
          <ul className="space-y-1">
            {show.microphones.map((m) => (
              <li key={m.id}>
                {m.model}
                <span className="text-neutral-500">
                  {" "}· {MIC_TYPE_LABEL[m.type]}
                  {m.needsPhantom && " · 48V"}
                  {m.defaultStand && ` · ${m.defaultStand}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 overflow-x-auto">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
