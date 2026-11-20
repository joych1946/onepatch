"use client";

/**
 * 스테이지박스 구성 + 자동 패치 + 패치 현황판.
 * 현황판(끌어다 놓기 패치)은 components/PatchBoard.
 */
import { useState } from "react";
import type { Show } from "@/model/schema";
import { autoPatch, boxColumns, boxOps, boxRemovalLoss, boxUsage } from "@/model/patch";
import { formatRanges, parseRanges } from "@/model/outputOps";
import { STAGEBOX_MODELS } from "@/model/stageboxModels";
import Sheet from "./Sheet";
import PatchBoard from "./PatchBoard";
import type { ValidationIssue } from "./useShowDoc";

interface Props {
  show: Show;
  apply: (fn: (s: Show) => Show) => void;
  undo: () => void;
  redo: () => void;
  issues: ValidationIssue[];
  onMessage: (text: string, details?: string[]) => void;
  focusRequest?: { row: number; col: string; n: number } | null;
}

export default function PatchView({ show, apply, undo, redo, issues, onMessage, focusRequest }: Props) {
  const boxIssues = new Map<string, string>();
  for (const i of issues) if (i.path[0] === "stageBoxes" && typeof i.path[1] === "number") boxIssues.set(`${i.path[1]}:name`, i.message);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h2 className="text-base font-semibold">스테이지박스 ({show.stageBoxes.length})</h2>
          <select
            className="rounded border border-blue-500 bg-transparent px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300"
            value=""
            aria-label="기종을 골라 스테이지박스 추가"
            onChange={(e) => {
              const name = e.target.value;
              apply((s) => {
                const x = boxOps.append(s);
                return boxColumns()[0].set(x, x.stageBoxes.length - 1, name) ?? x;
              });
              onMessage(`${name} 박스를 추가했습니다. 인풋·아웃풋 수는 표에서 고칠 수 있습니다.`);
            }}
          >
            <option value="" disabled>기종으로 박스 추가…</option>
            {STAGEBOX_MODELS.map((m) => (
              <option key={m.name} value={m.name}>
                {m.maker} {m.name} — 인 {m.inputs} / 아웃 {m.outputs}{m.note ? ` (${m.note})` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">맨 아래 빈 행에 입력하면 박스 추가 · 인풋·아웃풋 수는 아무 숫자나 · 이름·위치·순서를 바꿔도 패치는 그대로 · ⌥⌫ 삭제(비워지는 패치가 있으면 먼저 알려줌)</p>
        </div>
        <Sheet
          label="스테이지박스"
          show={show}
          rows={show.stageBoxes}
          rowKey={(b) => b.id}
          columns={boxColumns()}
          ops={boxOps}
          apply={apply}
          undo={undo}
          redo={redo}
          renumber={false}
          issues={boxIssues}
          onMessage={onMessage}
          autoFocus
          focusRequest={focusRequest}
          confirmRemove={(s, from, to) => {
            const ids = s.stageBoxes.slice(from, to + 1).map((b) => b.id);
            const loss = boxRemovalLoss(s, ids);
            if (!loss.length) return null;
            const shown = loss.slice(0, 15).join("\n");
            return `박스를 지우면 아래 ${loss.length}개의 패치가 비워집니다.\n\n${shown}${loss.length > 15 ? `\n… 외 ${loss.length - 15}개` : ""}\n\n지울까요? (⌘Z로 되돌릴 수 있습니다)`;
          }}
        />
      </section>

      <AutoPatchForm show={show} apply={apply} onMessage={onMessage} />

      <PatchBoard show={show} apply={apply} onMessage={onMessage} />
    </div>
  );
}

/* ───────────── 자동 패치 ───────────── */

function AutoPatchForm({ show, apply, onMessage }: Pick<Props, "show" | "apply" | "onMessage">) {
  const unpatched = show.inputs.filter((c) => !c.port).map((c) => c.number);
  const [chText, setChText] = useState("");
  const [boxId, setBoxId] = useState(show.stageBoxes[0]?.id ?? "");
  const [start, setStart] = useState("1");
  const box = show.stageBoxes.find((b) => b.id === boxId) ?? show.stageBoxes[0];
  const input = "rounded border border-neutral-300 bg-transparent px-2 py-1 outline-none focus:ring-2 focus:ring-blue-600 dark:border-neutral-700";

  const run = () => {
    if (!box) return onMessage("스테이지박스가 없습니다. 위 표에 먼저 추가하세요.");
    const nums = chText.trim() ? parseRanges(chText) : new Set(unpatched);
    if (!nums) return onMessage(`채널 "${chText}"을(를) 알아볼 수 없습니다. 예: 1-16, 21`);
    const rows = show.inputs.flatMap((c, i) => (nums.has(c.number) ? [i] : []));
    if (!rows.length) return onMessage("배정할 채널이 없습니다.");
    const r = autoPatch(show, rows, box.id, parseInt(start, 10) || 1);
    apply(() => r.show);
    onMessage(
      `${box.name}에 ${r.assigned}채널을 배정했습니다.` +
        (r.left.length ? ` 빈 포트가 모자라 ${r.left.length}채널(Ch ${formatRanges(r.left)})은 배정하지 못했습니다.` : ""),
    );
  };

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">자동 패치</h2>
      <form
        className="flex flex-wrap items-end gap-3 rounded border border-neutral-200 p-3 dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          채널
          <input
            className={`${input} w-44 text-sm text-neutral-900 dark:text-neutral-100`}
            value={chText}
            onChange={(e) => setChText(e.target.value)}
            placeholder={unpatched.length ? `비우면 미패치 ${formatRanges(unpatched)}` : "예: 1-16, 21"}
            aria-label="자동 패치할 채널"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          박스
          <select className={`${input} text-sm text-neutral-900 dark:text-neutral-100`} value={box?.id ?? ""} onChange={(e) => setBoxId(e.target.value)} aria-label="자동 패치할 박스">
            {show.stageBoxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (빈 인풋 {b.inputs - boxUsage(show, b.id).ins.size})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          시작 포트
          <input className={`${input} w-20 text-sm text-neutral-900 dark:text-neutral-100`} type="number" min={1} value={start} onChange={(e) => setStart(e.target.value)} aria-label="시작 포트" />
        </label>
        <button type="submit" className="rounded border border-blue-500 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-neutral-100 dark:text-blue-300 dark:hover:bg-neutral-800">
          빈 포트에 순서대로 배정
        </button>
        <p className="w-full text-xs text-neutral-500">
          고른 채널을 번호 순서대로, 시작 포트부터 비어 있는 포트에 넣습니다. 인풋 표에서 행을 고르고 툴바의 “자동 패치”로도 할 수 있습니다.
        </p>
      </form>
    </section>
  );
}
