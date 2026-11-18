"use client";

/**
 * DCA·뮤트 그룹 정의. 멤버는 채널 쪽(dcaIds/muteGroupIds)에 저장되므로
 * 여기서 바꾸면 인풋 그리드의 DCA 열에, 인풋 그리드에서 바꾸면 여기에 그대로 나타난다.
 */
import { useMemo, useRef, useState } from "react";
import type { Show } from "@/model/schema";
import { COLOR_SWATCH } from "@/model/labels";
import { groupAccess, groupMembers, groupsOf, rowOps, setGroupMembers, toggleGroupMember, type GroupKind } from "@/model/outputOps";
import { groupColumns } from "@/model/outputColumns";
import { norm } from "@/model/text";
import Sheet, { type SheetHandle } from "./Sheet";
import ChoiceSheet, { type ChoiceSection } from "./ChoiceSheet";
import type { ValidationIssue } from "./useShowDoc";

const KINDS: { kind: GroupKind; title: string; label: string }[] = [
  { kind: "dca", title: "DCA", label: "DCA" },
  { kind: "mute", title: "뮤트 그룹", label: "Mute" },
];

interface Props {
  show: Show;
  apply: (fn: (s: Show) => Show) => void;
  undo: () => void;
  redo: () => void;
  renumber: boolean;
  issues: ValidationIssue[];
  onMessage: (text: string, details?: string[]) => void;
}

export default function GroupsView({ show, apply, undo, redo, renumber, issues, onMessage }: Props) {
  const [picker, setPicker] = useState<{ kind: GroupKind; row: number } | null>(null);
  const handles = useRef<Record<GroupKind, SheetHandle | null>>({ dca: null, mute: null });

  const issueMaps = useMemo(() => {
    const maps: Record<GroupKind, Map<string, string>> = { dca: new Map(), mute: new Map() };
    for (const i of issues) {
      const k = i.path[0] === "dcas" ? "dca" : i.path[0] === "muteGroups" ? "mute" : null;
      if (k && typeof i.path[1] === "number") maps[k].set(`${i.path[1]}:num`, i.message);
    }
    return maps;
  }, [issues]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {KINDS.map(({ kind, title }, k) => {
        const rows = groupsOf(show, kind);
        return (
          <section key={kind}>
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <h2 className="text-base font-semibold">
                {title} <span className="text-sm font-normal text-neutral-500">({rows.length})</span>
              </h2>
              <p className="text-xs text-neutral-500">멤버 칸: “1-4, 7”처럼 입력하거나 눌러서 채널 선택</p>
            </div>
            <Sheet
              label={title}
              show={show}
              rows={rows}
              rowKey={(g) => g.id}
              columns={groupColumns(kind)}
              ops={rowOps(groupAccess(kind))}
              apply={apply}
              undo={undo}
              redo={redo}
              renumber={renumber}
              issues={issueMaps[kind]}
              onMessage={onMessage}
              onPick={(row) => {
                // 빈 행이면 그룹을 먼저 만든다
                if (row >= rows.length) apply((s) => rowOps(groupAccess(kind)).append(s));
                setPicker({ kind, row });
              }}
              onExit={(dir) => {
                const next = KINDS[k + dir];
                if (next) handles.current[next.kind]?.focus(dir > 0 ? "top" : "bottom");
              }}
              handle={(h) => {
                handles.current[kind] = h;
              }}
              autoFocus={k === 0}
              paused={picker !== null}
            />
          </section>
        );
      })}

      {picker && groupsOf(show, picker.kind)[picker.row] && (
        <MemberPicker
          show={show}
          kind={picker.kind}
          row={picker.row}
          apply={apply}
          onClose={() => {
            const k = picker.kind;
            setPicker(null);
            requestAnimationFrame(() => handles.current[k]?.focus("top"));
          }}
        />
      )}
    </div>
  );
}

/** 채널을 눌러 멤버로 넣고 빼기 (창은 열린 채로) */
function MemberPicker({
  show,
  kind,
  row,
  apply,
  onClose,
}: {
  show: Show;
  kind: GroupKind;
  row: number;
  apply: (fn: (s: Show) => Show) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const group = groupsOf(show, kind)[row];
  const members = new Set(groupMembers(show, kind, group.id));
  const q = norm(query);
  const name = `${kind === "dca" ? "DCA" : "Mute"} ${group.number}${group.name ? ` ${group.name}` : ""}`;

  const channels = show.inputs.filter(
    (c) => !q || String(c.number) === query.trim() || norm(c.source).includes(q) || norm(c.shortName).includes(q),
  );
  const sections: ChoiceSection[] = [
    {
      title: `채널 (${members.size}개 선택됨)`,
      items: channels.map((c) => ({
        key: c.id,
        label: `${c.number} ${c.source || c.shortName || ""}`.trim(),
        sub: c.shortName && c.shortName !== c.source ? c.shortName : undefined,
        selected: members.has(c.number),
        run: () => apply((s) => toggleGroupMember(s, kind, group.id, c.id)),
      })),
    },
  ];

  return (
    <ChoiceSheet
      title={`${name} · 멤버`}
      query={query}
      setQuery={setQuery}
      placeholder="채널 번호·이름 검색"
      sections={sections}
      onClose={onClose}
      extra={
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            onClick={() => apply((s) => setGroupMembers(s, kind, group.id, new Set(channels.map((c) => c.number))))}
          >
            {q ? "검색된 채널 모두 넣기" : "모두 넣기"}
          </button>
          <button
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            onClick={() => apply((s) => setGroupMembers(s, kind, group.id, new Set()))}
          >
            모두 빼기
          </button>
          {[...new Set(show.inputs.map((c) => c.color))].filter((c) => c !== "none").map((color) => (
            <button
              key={color}
              title="이 컬러 채널을 모두 넣기"
              className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              onClick={() =>
                apply((s) =>
                  setGroupMembers(s, kind, group.id, new Set([...members, ...s.inputs.filter((c) => c.color === color).map((c) => c.number)])),
                )
              }
            >
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COLOR_SWATCH[color] }} />+
            </button>
          ))}
        </div>
      }
      hint={<><kbd>↑↓</kbd> 이동 · <kbd>Enter</kbd> 넣기/빼기 · <kbd>Esc</kbd> 닫기</>}
    />
  );
}
