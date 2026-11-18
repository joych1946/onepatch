"use client";

/** Show 화면: 인풋리스트 편집 그리드 + (아직 편집 화면이 없는 항목은) 읽기 전용 보기 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Show } from "@/model/schema";
import { showFileName, showToJson } from "@/model/serialize";
import { BUS_KIND_LABEL, BUS_PURPOSE_LABEL, MIC_TYPE_LABEL, formatPort } from "@/model/labels";
import { downloadText, isTypingTarget } from "@/lib/download";
import InputGrid from "./InputGrid";
import { useShowDoc, type SaveStatus } from "./useShowDoc";

const th = "py-1.5 pr-3 text-left font-medium text-neutral-500 whitespace-nowrap";
const td = "py-1 pr-3 align-top";
const RENUMBER_KEY = "onepatch.renumber";

type Message = { text: string; details?: string[] };

export default function ShowView({ id }: { id: string }) {
  const router = useRouter();
  const doc = useShowDoc(id);
  const { show } = doc;
  const [message, setMessage] = useState<Message | null>(null);
  const [renumber, setRenumber] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(RENUMBER_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v !== null) setRenumber(v === "1");
    } catch {}
  }, []);

  const toggleRenumber = (v: boolean) => {
    setRenumber(v);
    try {
      localStorage.setItem(RENUMBER_KEY, v ? "1" : "0");
    } catch {}
  };

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

  if (doc.loadError) return <main className="p-6 text-red-600 whitespace-pre-wrap">{doc.loadError}</main>;
  if (doc.notFound)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const allIssues = [...doc.errors, ...doc.warnings];
  const otherIssues = allIssues.filter((i) => i.path[0] !== "inputs");
  const inputIssues = allIssues.filter((i) => i.path[0] === "inputs");
  const btn =
    "rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40";

  return (
    <main className="mx-auto w-full max-w-[1400px] p-6 text-sm">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <Link href="/" className="text-neutral-500 hover:underline">
            ← 목록
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{show.title}</h1>
          <p className="text-neutral-500">
            {[show.date, show.venue, show.author && `작성 ${show.author}`, show.version]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <SaveBadge status={doc.status} warnings={doc.warnings.length} />
        <button className={btn} onClick={doc.undo} disabled={!doc.canUndo} title="⌘Z / Ctrl+Z">
          실행 취소
        </button>
        <button className={btn} onClick={doc.redo} disabled={!doc.canRedo} title="⇧⌘Z / Ctrl+Y">
          다시 실행
        </button>
        <button className={btn} onClick={exportJson}>
          JSON 내보내기
        </button>
      </header>

      <section className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-4">
          <h2 className="text-base font-semibold">인풋 ({show.inputs.length}ch)</h2>
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={renumber} onChange={(e) => toggleRenumber(e.target.checked)} />
            행 추가·삭제·이동 시 채널 번호를 순서대로 다시 매기기
          </label>
        </div>

        <InputGrid
          show={show}
          apply={doc.apply}
          undo={doc.undo}
          redo={doc.redo}
          issues={allIssues}
          renumber={renumber}
          onMessage={(text, details) => setMessage({ text, details })}
        />

        {(message || inputIssues.length > 0) && (
          <div className="mt-2 space-y-2 text-xs">
            {inputIssues.length > 0 && (
              <div className="rounded border border-red-400 bg-red-50 px-3 py-2 text-red-800 dark:bg-red-950 dark:text-red-200">
                확인할 항목 {inputIssues.length}건 — 빨간 셀에 마우스를 올리면 이유가 보입니다
                {doc.errors.length > 0 ? " (고치기 전에는 저장되지 않음)" : " (저장은 됨)"}
                <ul className="mt-1 list-disc pl-5">
                  {inputIssues.slice(0, 5).map((i, k) => (
                    <li key={k}>{i.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {message && (
              <div role="status" className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                <div className="flex justify-between gap-4">
                  <span>{message.text}</span>
                  <button className="opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>
                    닫기
                  </button>
                </div>
                {message.details && (
                  <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
                    {message.details.map((d, k) => (
                      <li key={k}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        {otherIssues.length > 0 && (
          <p className="mt-2 text-xs text-red-600">기타 검증 오류: {otherIssues.map((i) => i.message).join(" / ")}</p>
        )}

        <details className="mt-3 text-xs text-neutral-500">
          <summary className="cursor-pointer">키보드 단축키</summary>
          <ul className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <li><kbd>←↑↓→</kbd> <kbd>Tab</kbd> 이동 · <kbd>Shift</kbd>+방향키 범위 선택 · <kbd>Shift</kbd>+<kbd>Space</kbd> 행 선택</li>
            <li>글자 입력 → 바로 덮어쓰기 · <kbd>Enter</kbd>/<kbd>F2</kbd> 기존 값 편집 · <kbd>Esc</kbd> 취소</li>
            <li>편집 후 <kbd>Enter</kbd> 아래로(Tab으로 시작한 열로 복귀) · 마지막 빈 행에 입력하면 채널 추가</li>
            <li><kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> 선택한 행 전체에 같은 값 입력 (일괄 변경)</li>
            <li>48V·링크 열: <kbd>Space</kbd>/<kbd>Enter</kbd> 켜고 끄기 (여러 행 선택 시 일괄)</li>
            <li><kbd>Delete</kbd> 지우기 (48V·스탠드는 마이크 기본값으로)</li>
            <li><kbd>⌘/Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> 복사·잘라내기·붙여넣기 (엑셀 호환, 헤더 자동 인식)</li>
            <li><kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> 실행 취소 · <kbd>⇧⌘Z</kbd>/<kbd>Ctrl</kbd>+<kbd>Y</kbd> 다시 실행</li>
            <li><kbd>⌥/Alt</kbd>+<kbd>N</kbd> 행 삽입 · <kbd>D</kbd> 복제 · <kbd>⌫</kbd> 삭제 · <kbd>↑↓</kbd> 순서 이동</li>
            <li>그리드 밖에서 <kbd>E</kbd> JSON 내보내기 · <kbd>Esc</kbd> 목록 (그리드에서 <kbd>Esc</kbd>로 빠져나옴)</li>
          </ul>
        </details>
      </section>

      <ReadonlySections show={show} />
    </main>
  );
}

function SaveBadge({ status, warnings }: { status: SaveStatus; warnings: number }) {
  const text =
    status.kind === "saved"
      ? (status.at ? `저장됨 ${status.at}` : "저장됨") + (warnings ? ` · 확인 필요 ${warnings}건` : "")
      : status.kind === "pending"
        ? "저장 중…"
        : status.kind === "invalid"
          ? `저장 안 됨 — 오류 ${status.count}건`
          : `저장 실패: ${status.message}`;
  const color =
    status.kind === "saved" || status.kind === "pending" ? "text-neutral-500" : "text-red-600 font-medium";
  return <span className={`self-center text-xs ${color}`}>{text}</span>;
}

/** 아직 편집 화면이 없는 항목 (다음 단계에서 편집 가능해짐) */
function ReadonlySections({ show }: { show: Show }) {
  return (
    <>
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
    </>
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
