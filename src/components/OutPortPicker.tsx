"use client";

/**
 * 아웃풋 "물리 출력" 칸을 누르면 뜨는 선택 창.
 * 아무 박스의 아무 출력 포트, 콘솔 본체(OMNI OUT), Dante 직결(검색창에 "Dante 70")을 고른다.
 * 스테레오 버스는 L → R 차례로 고르고(위의 L/R 버튼으로 바로 옮겨 갈 수 있음), 마지막에 한 번에 반영한다.
 * Esc·닫기는 아무것도 바꾸지 않는다.
 */
import { useState } from "react";
import type { BusKind, PortRef, Show } from "@/model/schema";
import { busesOf, updateBus } from "@/model/outputOps";
import { outPortChoices, setPortAt } from "@/model/patch";
import { formatOutPorts } from "@/model/outputColumns";
import { DANTE_PREFIX, LOCAL_PREFIX } from "@/model/inputColumns";
import { norm } from "@/model/text";
import ChoiceSheet, { type ChoiceItem, type ChoiceSection } from "./ChoiceSheet";

interface Props {
  show: Show;
  kind: BusKind;
  row: number;
  apply: (fn: (s: Show) => Show) => void;
  onClose: () => void;
}

export default function OutPortPicker({ show, kind, row, apply, onClose }: Props) {
  const bus = busesOf(show, kind)[row];
  const stereo = bus?.width === "stereo";
  const [side, setSide] = useState(0);
  const [draft, setDraft] = useState<PortRef[]>(bus?.ports ?? []);
  const [query, setQuery] = useState("");
  if (!bus) return null;

  const kindLabel = kind === "aux" ? "Aux" : kind === "matrix" ? "Matrix" : "Main";
  const sideName = (i: number) => (stereo ? (i === 0 ? "L" : "R") : "");
  const now = (i: number) => (draft[i] ? formatOutPorts(show, [draft[i]]) : "비어 있음");

  const finish = (ports: PortRef[]) => {
    apply((s) => updateBus(s, kind, row, { ports }));
    onClose();
  };
  const choose = (ref: PortRef | null) => {
    const next = setPortAt(draft, side, ref);
    setQuery("");
    if (stereo && side === 0) {
      setDraft(next);
      setSide(1);
    } else finish(next);
  };

  const q = norm(query);
  const choices = outPortChoices(show, bus.id);
  const sections: ChoiceSection[] = [];
  const top: ChoiceItem[] = [
    { key: "clear", label: "비우기", sub: `${sideName(side) ? `${sideName(side)} ` : ""}물리 출력 없음`, run: () => choose(null) },
  ];
  if (stereo && side === 1)
    top.unshift({ key: "keep", label: "R은 그대로", sub: `지금: ${now(1)}`, run: () => finish(draft) });
  if (!q) sections.push({ title: "", items: top });

  // 검색창에 "Dante 70", "OMNI 3"처럼 쓰면 그 포트를 바로 고를 수 있게
  const typed = query.trim().match(/^(.*?)[\s:#.\-]*(\d+)$/);
  if (typed && (DANTE_PREFIX.test(norm(typed[1])) || LOCAL_PREFIX.test(norm(typed[1])))) {
    const n = parseInt(typed[2], 10);
    const ref: PortRef = DANTE_PREFIX.test(norm(typed[1])) ? { kind: "dante", port: n } : { kind: "local", port: n };
    if (n >= 1)
      sections.push({ title: "입력한 포트", items: [{ key: "typed", label: formatOutPorts(show, [ref]), sub: ref.kind === "dante" ? "박스 없이 콘솔의 Dante OUT 번호" : "콘솔 본체 출력", run: () => choose(ref) }] });
  }

  const groups = [...new Set(choices.map((c) => c.group))];
  for (const g of groups) {
    const items = choices
      .filter((c) => c.group === g && (!q || norm(c.label).includes(q) || norm(c.group).includes(q)))
      .map((c, i): ChoiceItem => {
        const mine = draft.findIndex((p) => formatOutPorts(show, [p]) === c.label);
        return {
          key: `${g}-${i}`,
          label: c.label,
          sub: mine >= 0 ? `이 버스 ${sideName(mine) || "출력"}` : c.users.length ? `사용 중: ${c.users.join(", ")}` : "",
          badge: c.users.length ? "겹침" : undefined,
          selected: mine === side ? true : undefined,
          run: () => choose(c.ref),
        };
      });
    if (items.length) sections.push({ title: g, items });
  }

  return (
    <ChoiceSheet
      title={`${kindLabel} ${bus.number} ${bus.name} · 물리 출력${stereo ? ` ${sideName(side)}` : ""}`}
      query={query}
      setQuery={setQuery}
      placeholder="포트 검색 (예: 1608 5, OMNI 3, Dante 70)"
      sections={sections}
      onClose={onClose}
      resetKey={side}
      extra={
        stereo ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {[0, 1].map((i) => (
              <button
                key={i}
                onClick={() => setSide(i)}
                aria-pressed={side === i}
                className={`rounded border px-2 py-1 ${side === i ? "border-blue-600 bg-blue-50 font-medium dark:bg-blue-950" : "border-neutral-300 dark:border-neutral-700"}`}
              >
                {sideName(i)}: {now(i)}
              </button>
            ))}
            {side === 1 && (
              <button className="rounded border border-blue-500 px-2 py-1 font-medium text-blue-700 dark:text-blue-300" onClick={() => finish(draft)}>
                이대로 적용
              </button>
            )}
            <span className="text-neutral-500">L을 비우면 R 출력이 첫 번째(L) 자리로 갑니다.</span>
          </div>
        ) : undefined
      }
      hint={
        <>
          <kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 선택{stereo ? " (L 다음 R)" : ""} · <kbd>Esc</kbd> 바꾸지 않고 닫기 · 표에서 <kbd>Enter</kbd>로 글자 입력도 됩니다
        </>
      }
    />
  );
}
