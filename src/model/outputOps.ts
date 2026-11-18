/**
 * 아웃풋(버스)·DCA·뮤트 그룹 편집 연산 — 전부 순수 함수 (Show → Show).
 * 표 하나가 Show 안의 목록 하나(예: Aux 버스들)를 다루므로, "목록 꺼내기/돌려놓기"와
 * 번호가 있는 항목의 행 조작(삽입·복제·삭제·이동)을 공통으로 둔다.
 */
import { newId } from "./factory";
import type { BusKind, Dca, MuteGroup, OutputBus, Show } from "./schema";

/* ───────────── 번호가 있는 목록 공통 ───────────── */

type Numbered = { id: string; number: number };

export const nextNum = (list: Numbered[]) => list.reduce((m, x) => Math.max(m, x.number), 0) + 1;

const renumber = <T extends Numbered>(list: T[]) =>
  list.map((x, i) => (x.number === i + 1 ? x : { ...x, number: i + 1 }));

/** Show 안의 목록 하나를 꺼내고 돌려놓는 방법 */
export interface ListAccess<T extends Numbered> {
  get(show: Show): T[];
  /** 목록을 바꾼다. removedIds: 삭제된 항목 (참조 정리용) */
  put(show: Show, list: T[], removedIds?: string[]): Show;
  create(number: number): T;
}

/** 표에서 쓰는 행 조작 (index는 그 목록 안에서의 위치) */
export interface RowOps {
  count(show: Show): number;
  append(show: Show): Show;
  insertAfter(show: Show, index: number, renumber: boolean): Show;
  duplicate(show: Show, from: number, to: number, renumber: boolean): Show;
  remove(show: Show, from: number, to: number, renumber: boolean): Show;
  move(show: Show, from: number, to: number, insertBefore: number, renumber: boolean): { show: Show; start: number };
}

export function rowOps<T extends Numbered>(acc: ListAccess<T>): RowOps {
  const fin = (show: Show, list: T[], re: boolean, removed?: string[]) =>
    acc.put(show, re ? renumber(list) : list, removed);
  return {
    count: (show) => acc.get(show).length,
    append(show) {
      const list = acc.get(show);
      return acc.put(show, [...list, acc.create(nextNum(list))]);
    },
    insertAfter(show, index, re) {
      const list = acc.get(show).slice();
      const wanted = (list[index]?.number ?? 0) + 1;
      const taken = list.some((x) => x.number === wanted);
      list.splice(index + 1, 0, acc.create(taken ? nextNum(list) : wanted));
      return fin(show, list, re);
    },
    duplicate(show, from, to, re) {
      const list = acc.get(show).slice();
      let n = nextNum(list);
      const copies = list.slice(from, to + 1).map((x) => ({ ...structuredClone(x), id: newId(), number: n++ }));
      list.splice(to + 1, 0, ...copies);
      return fin(show, list, re);
    },
    remove(show, from, to, re) {
      const list = acc.get(show).slice();
      const removed = list.splice(from, to - from + 1).map((x) => x.id);
      return fin(show, list, re, removed);
    },
    move(show, from, to, insertBefore, re) {
      if (insertBefore >= from && insertBefore <= to + 1) return { show, start: from };
      const list = acc.get(show).slice();
      const block = list.splice(from, to - from + 1);
      const start = insertBefore > to ? insertBefore - block.length : insertBefore;
      list.splice(start, 0, ...block);
      return { show: fin(show, list, re), start };
    },
  };
}

/* ───────────── 버스 ───────────── */

const KIND_ORDER: BusKind[] = ["aux", "matrix", "main"];

export function newBus(kind: BusKind, number: number): OutputBus {
  return {
    id: newId(),
    kind,
    number,
    name: "",
    purpose: "other",
    width: "mono",
    // 모니터 센드는 보통 프리, 그 외는 포스트
    tap: kind === "aux" ? "pre" : "post",
    ports: [],
    sources: [],
    notes: "",
  };
}

export const busesOf = (show: Show, kind: BusKind) => show.outputs.filter((b) => b.kind === kind);

/** 한 종류의 버스 목록을 바꾼다. 출력 순서는 Aux → Matrix → Main. 지운 버스는 Matrix 소스에서도 뺀다. */
export function putBuses(show: Show, kind: BusKind, list: OutputBus[], removedIds: string[] = []): Show {
  const byKind = (k: BusKind) => (k === kind ? list : busesOf(show, k));
  let outputs = KIND_ORDER.flatMap(byKind);
  if (removedIds.length) {
    const gone = new Set(removedIds);
    outputs = outputs.map((b) =>
      b.sources.some((id) => gone.has(id)) ? { ...b, sources: b.sources.filter((id) => !gone.has(id)) } : b,
    );
  }
  return { ...show, outputs };
}

export const busAccess = (kind: BusKind): ListAccess<OutputBus> => ({
  get: (show) => busesOf(show, kind),
  put: (show, list, removed) => putBuses(show, kind, list, removed),
  create: (number) => newBus(kind, number),
});

export function updateBus(show: Show, kind: BusKind, index: number, patch: Partial<OutputBus>): Show {
  const list = busesOf(show, kind).slice();
  list[index] = { ...list[index], ...patch };
  return putBuses(show, kind, list);
}

/** 화면 표시용 버스 이름: "Aux 3 Drum IEM", "Main L/R" */
export function busLabel(b: OutputBus): string {
  if (b.kind === "main") return b.name || `Main ${b.number}`;
  const k = b.kind === "aux" ? "Aux" : "Matrix";
  return b.name ? `${k} ${b.number} ${b.name}` : `${k} ${b.number}`;
}

/* ───────────── DCA·뮤트 그룹 ───────────── */

export type GroupKind = "dca" | "mute";

const groupKey = (k: GroupKind): "dcas" | "muteGroups" => (k === "dca" ? "dcas" : "muteGroups");
const memberKey = (k: GroupKind): "dcaIds" | "muteGroupIds" => (k === "dca" ? "dcaIds" : "muteGroupIds");

export const groupsOf = (show: Show, k: GroupKind): (Dca | MuteGroup)[] => show[groupKey(k)];

export const groupAccess = (k: GroupKind): ListAccess<Dca | MuteGroup> => ({
  get: (show) => groupsOf(show, k),
  put(show, list, removed = []) {
    let s: Show = { ...show, [groupKey(k)]: list };
    if (removed.length) {
      // 지운 그룹은 채널에서도 뺀다 (깨진 참조가 남지 않게)
      const gone = new Set(removed);
      const key = memberKey(k);
      s = {
        ...s,
        inputs: s.inputs.map((c) => (c[key].some((id) => gone.has(id)) ? { ...c, [key]: c[key].filter((id) => !gone.has(id)) } : c)),
      };
    }
    return s;
  },
  create: (number) => ({ id: newId(), number, name: "" }),
});

/** 그룹에 속한 채널 번호들 (인풋 그리드의 DCA 열과 같은 데이터: 채널의 dcaIds/muteGroupIds) */
export function groupMembers(show: Show, k: GroupKind, groupId: string): number[] {
  const key = memberKey(k);
  return show.inputs.filter((c) => c[key].includes(groupId)).map((c) => c.number);
}

/** 그룹 멤버를 채널 번호 목록으로 정한다 */
export function setGroupMembers(show: Show, k: GroupKind, groupId: string, numbers: Set<number>): Show {
  const key = memberKey(k);
  let changed = false;
  const inputs = show.inputs.map((c) => {
    const has = c[key].includes(groupId);
    const want = numbers.has(c.number);
    if (has === want) return c;
    changed = true;
    return { ...c, [key]: want ? [...c[key], groupId] : c[key].filter((id) => id !== groupId) };
  });
  return changed ? { ...show, inputs } : show;
}

export function toggleGroupMember(show: Show, k: GroupKind, groupId: string, channelId: string): Show {
  const key = memberKey(k);
  return {
    ...show,
    inputs: show.inputs.map((c) =>
      c.id !== channelId
        ? c
        : { ...c, [key]: c[key].includes(groupId) ? c[key].filter((id) => id !== groupId) : [...c[key], groupId] },
    ),
  };
}

/** "1-4, 7, 9" ↔ [1,2,3,4,7,9] */
export function formatRanges(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j - i >= 2 ? `${s[i]}-${s[j]}` : j > i ? `${s[i]}, ${s[j]}` : `${s[i]}`);
    i = j;
  }
  return out.join(", ");
}

export function parseRanges(text: string): Set<number> | null {
  const out = new Set<number>();
  for (const tok of text.split(/[,\s;/]+/).filter(Boolean)) {
    const m = tok.match(/^(?:ch)?(\d+)(?:[-~–](?:ch)?(\d+))?$/i);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  return out;
}
