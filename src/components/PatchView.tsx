"use client";

/**
 * 스테이지박스 구성 + 자동 패치 + 패치 현황판.
 * 현황판의 포트는 드래그해서 다른 포트에 놓거나, 누르고 바꿀 포트를 누르면 서로 바뀐다(터치·키보드 겸용).
 */
import { useEffect, useState } from "react";
import type { Show, StageBox } from "@/model/schema";
import { COLOR_SWATCH } from "@/model/labels";
import { autoPatch, boxColumns, boxOps, boxRemovalLoss, boxUsage, DANTE_BOX, OMNI_BOX, swapPorts, type PortAddr } from "@/model/patch";
import { formatRanges, parseRanges } from "@/model/outputOps";
import Sheet from "./Sheet";
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

      <PatchBoard show={show} apply={apply} />
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

/* ───────────── 현황판 ───────────── */

function PatchBoard({ show, apply }: Pick<Props, "show" | "apply">) {
  const [picked, setPicked] = useState<PortAddr | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  const keyOf = (p: PortAddr) => `${p.dir}:${p.boxId}:${p.port}`;
  const swap = (a: PortAddr, b: PortAddr) => {
    if (a.dir !== b.dir) return;
    apply((s) => swapPorts(s, a, b));
  };
  const press = (p: PortAddr) => {
    if (!picked) return setPicked(p);
    if (keyOf(picked) === keyOf(p)) return setPicked(null);
    if (picked.dir !== p.dir) return setPicked(p);
    swap(picked, p);
    setPicked(null);
  };

  // 박스 없는 포트: 콘솔 본체 단자(OMNI)는 늘, Dante 직결은 쓰고 있을 때만 (그리드에 "Dante 33"처럼 입력)
  const omni: StageBox = { id: OMNI_BOX, name: "콘솔 본체 (OMNI)", inputs: 16, outputs: 16, location: "박스 없이 콘솔에 바로" };
  const dante: StageBox = { id: DANTE_BOX, name: "Dante 직결", inputs: 0, outputs: 0, location: "박스 없이 콘솔의 Dante 번호로 — 인풋 표에 “Dante 33”처럼 입력" };
  const danteUsed = boxUsage(show, DANTE_BOX);
  const virtual = [omni, ...(danteUsed.ins.size || danteUsed.outs.size ? [dante] : [])];
  const boxName = (id: string) => [...show.stageBoxes, ...virtual].find((b) => b.id === id)?.name ?? "?";

  return (
    <section data-esc-layer={picked ? "" : undefined}>
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-semibold">패치 현황판</h2>
        <p className="text-xs text-neutral-500" role="status">
          {picked
            ? `${boxName(picked.boxId)} ${picked.dir === "in" ? "인풋" : "아웃풋"} ${picked.port} 선택됨 — 바꿀 포트를 누르세요 (Esc 취소)`
            : "포트를 끌어다 다른 포트에 놓거나, 누르고 바꿀 포트를 누르면 서로 바뀝니다. 빈 포트에 놓으면 옮겨집니다."}
        </p>
      </div>
      <div className="space-y-6">
        {show.stageBoxes.map((box) => (
          <BoxCard key={box.id} show={show} box={box} picked={picked} dropOn={dropOn} setDropOn={setDropOn} onPress={press} onSwap={swap} />
        ))}
        {virtual.map((box) => (
          <BoxCard key={box.id} show={show} box={box} virtual picked={picked} dropOn={dropOn} setDropOn={setDropOn} onPress={press} onSwap={swap} />
        ))}
      </div>
    </section>
  );
}

function BoxCard({
  show,
  box,
  virtual,
  picked,
  dropOn,
  setDropOn,
  onPress,
  onSwap,
}: {
  show: Show;
  box: StageBox;
  /** 박스 없는 포트 묶음: 포트 수 제한이 없고, 쓰는 포트 + 기본 칸 수만큼 보여 준다 */
  virtual?: boolean;
  picked: PortAddr | null;
  dropOn: string | null;
  setDropOn: (k: string | null) => void;
  onPress: (p: PortAddr) => void;
  onSwap: (a: PortAddr, b: PortAddr) => void;
}) {
  const { ins, outs } = boxUsage(show, box.id);
  const maxIn = Math.max(box.inputs, ...ins.keys());
  const maxOut = Math.max(box.outputs, ...outs.keys());

  const cell = (dir: "in" | "out", port: number) => {
    const addr: PortAddr = { dir, boxId: box.id, port };
    const key = `${dir}:${box.id}:${port}`;
    const over = !virtual && port > (dir === "in" ? box.inputs : box.outputs);
    let label = "";
    let sub = "";
    let color: string | undefined;
    let count = 0;
    if (dir === "in") {
      const users = ins.get(port) ?? [];
      count = users.length;
      const ch = users[0] && show.inputs[users[0].channelIndex];
      if (ch) {
        label = `${ch.number}${count > 1 ? `+${users.slice(1).map((u) => show.inputs[u.channelIndex].number).join("+")}` : ""}`;
        sub = ch.shortName || ch.source;
        color = ch.color === "none" ? undefined : COLOR_SWATCH[ch.color];
      }
    } else {
      const users = outs.get(port) ?? [];
      count = users.length;
      const u = users[0];
      if (u) {
        const k = u.bus.kind === "aux" ? "Aux" : u.bus.kind === "matrix" ? "Mtx" : "";
        label = `${k ? `${k} ${u.bus.number}` : u.bus.name}${u.bus.width === "stereo" ? (u.side === 0 ? " L" : u.side === 1 ? " R" : "") : ""}`;
        sub = k ? u.bus.name : "";
        if (count > 1) label += ` +${count - 1}`;
      }
    }
    const isPicked = picked && `${picked.dir}:${picked.boxId}:${picked.port}` === key;
    const bad = count > 1 || (over && count > 0);
    return (
      <button
        key={key}
        draggable={count > 0}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-onepatch-port", JSON.stringify(addr));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/x-onepatch-port")) return;
          e.preventDefault();
          setDropOn(key);
        }}
        onDragLeave={() => setDropOn(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDropOn(null);
          const raw = e.dataTransfer.getData("text/x-onepatch-port");
          if (raw) onSwap(JSON.parse(raw), addr);
        }}
        onClick={() => onPress(addr)}
        aria-label={`${box.name} ${dir === "in" ? "인풋" : "아웃풋"} ${port}${label ? ` ${label} ${sub}` : " 비어 있음"}`}
        aria-pressed={!!isPicked}
        title={bad ? (count > 1 ? "같은 포트를 여럿이 사용" : "박스 포트 수 초과") : undefined}
        className={`relative flex h-14 min-w-0 flex-col items-start justify-start overflow-hidden rounded border px-1.5 py-1 text-left text-xs ${
          count ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700"
        } ${bad ? "border-red-500 bg-red-50 dark:bg-red-950/60" : ""} ${over && !count ? "hidden" : ""} ${isPicked ? "ring-2 ring-blue-600" : ""} ${
          dropOn === key ? "ring-2 ring-blue-400" : ""
        } ${count ? "cursor-grab" : ""}`}
      >
        {color && <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />}
        <span className="text-[10px] text-neutral-400 tabular-nums">{port}</span>
        <span className="w-full truncate font-medium">{label}</span>
        {sub && <span className="w-full truncate text-[10px] text-neutral-500">{sub}</span>}
      </button>
    );
  };

  const grid = "grid grid-cols-4 gap-1 sm:grid-cols-8 lg:grid-cols-16";
  return (
    <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">{box.name}</h3>
        <span className="text-xs text-neutral-500">{box.location}</span>
        <span className="ml-auto text-xs text-neutral-500">
          {virtual ? `사용 인풋 ${ins.size} · 아웃풋 ${outs.size}` : `인풋 ${ins.size}/${box.inputs} · 아웃풋 ${outs.size}/${box.outputs}`}
        </span>
      </div>
      {maxIn > 0 && (
        <>
          <p className="mb-1 text-xs font-medium text-neutral-500">인풋</p>
          <div className={grid}>{Array.from({ length: maxIn }, (_, i) => cell("in", i + 1))}</div>
        </>
      )}
      {maxOut > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs font-medium text-neutral-500">아웃풋</p>
          <div className={grid}>{Array.from({ length: maxOut }, (_, i) => cell("out", i + 1))}</div>
        </>
      )}
    </div>
  );
}
