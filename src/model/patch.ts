/**
 * 스테이지박스 패치 — 순수 함수 (Show → Show).
 * 포트 정보는 채널(port)과 버스(ports)에만 있다. 현황판은 거기서 계산해 보여줄 뿐이다.
 */
import { newId } from "./factory";
import type { RowOps } from "./outputOps";
import type { OutputBus, PortRef, Show, StageBox } from "./schema";
import type { SheetColumn } from "./sheet";

export type PortDir = "in" | "out";
/** 현황판의 포트 주소. boxId가 OMNI_BOX/DANTE_BOX면 박스 없는 포트(콘솔 본체 단자, Dante 직결) */
export type PortAddr = { dir: PortDir; boxId: string; port: number };

/** 현황판에서 박스처럼 다루는 박스 없는 포트 묶음 (Show의 stageBoxes에는 없다) */
export const OMNI_BOX = "@omni";
export const DANTE_BOX = "@dante";

/** 주소 → 포트 참조 */
export function refAt(boxId: string, port: number): PortRef {
  if (boxId === OMNI_BOX) return { kind: "local", port };
  if (boxId === DANTE_BOX) return { kind: "dante", port };
  return { kind: "stagebox", stageBoxId: boxId, port };
}

/** 포트 참조가 놓인 묶음 (박스 id 또는 OMNI_BOX/DANTE_BOX). 자유 텍스트는 null */
export function groupOf(p: PortRef | null | undefined): string | null {
  if (!p || p.kind === "other") return null;
  return p.kind === "stagebox" ? p.stageBoxId : p.kind === "local" ? OMNI_BOX : DANTE_BOX;
}

const isAt = (p: PortRef | null | undefined, boxId: string, port: number) =>
  !!p && p.kind !== "other" && groupOf(p) === boxId && p.port === port;

/* ───────────── 현황 ───────────── */

export type InUse = { channelIndex: number };
export type OutUse = { bus: OutputBus; side: number };

/** 박스 하나의 포트별 사용 현황 (같은 포트를 여럿이 쓰면 배열에 여럿) */
export function boxUsage(show: Show, boxId: string) {
  const ins = new Map<number, InUse[]>();
  const outs = new Map<number, OutUse[]>();
  show.inputs.forEach((c, i) => {
    if (c.port && c.port.kind !== "other" && groupOf(c.port) === boxId)
      ins.set(c.port.port, [...(ins.get(c.port.port) ?? []), { channelIndex: i }]);
  });
  show.outputs.forEach((b) =>
    b.ports.forEach((p, side) => {
      if (p.kind !== "other" && groupOf(p) === boxId) outs.set(p.port, [...(outs.get(p.port) ?? []), { bus: b, side }]);
    }),
  );
  return { ins, outs };
}

/** 박스 없는 포트 중 고르기 목록에 늘 보여 줄 콘솔 본체 단자 수 (기종 한도가 아니라 목록 길이) */
export const OMNI_LIST = 16;

/**
 * 비어 있는 포트 후보 (그리드 입력·선택 창용): 박스별 빈 포트 → 콘솔 본체(OMNI) 빈 단자.
 * keep: 지금 이 칸이 쓰는 포트는 비어 있는 것으로 친다.
 */
export function freePorts(show: Show, dir: PortDir, keep: PortRef[] = []): PortRef[] {
  const used = new Set<string>();
  const key = (p: PortRef) => `${groupOf(p)}:${p.kind === "other" ? "" : p.port}`;
  if (dir === "in") show.inputs.forEach((c) => c.port && c.port.kind !== "other" && used.add(key(c.port)));
  else show.outputs.forEach((b) => b.ports.forEach((p) => p.kind !== "other" && used.add(key(p))));
  keep.forEach((p) => used.delete(key(p)));
  const out: PortRef[] = [];
  for (const b of show.stageBoxes)
    for (let n = 1; n <= (dir === "in" ? b.inputs : b.outputs); n++) {
      const r = refAt(b.id, n);
      if (!used.has(key(r))) out.push(r);
    }
  for (let n = 1; n <= OMNI_LIST; n++) {
    const r = refAt(OMNI_BOX, n);
    if (!used.has(key(r))) out.push(r);
  }
  return out;
}

/* ───────────── 자동 패치 ───────────── */

/**
 * 채널들(행 순서대로)을 박스의 빈 인풋 포트에 startPort부터 차례로 배정한다.
 * 이 채널들이 지금 쓰고 있는 포트는 비어 있는 것으로 본다(다시 배정하므로).
 * 반환: 새 Show, 배정한 수, 빈 포트가 모자라 못 한 채널 번호들
 */
export function autoPatch(show: Show, rows: number[], boxId: string, startPort = 1) {
  const box = show.stageBoxes.find((b) => b.id === boxId);
  if (!box) return { show, assigned: 0, left: rows.map((r) => show.inputs[r]?.number).filter(Boolean) as number[] };
  const order = [...new Set(rows)].filter((r) => show.inputs[r]).sort((a, b) => a - b);
  const mine = new Set(order);
  const portIn = (i: number) => {
    const p = show.inputs[i].port;
    return p?.kind === "stagebox" && p.stageBoxId === boxId ? p.port : null;
  };
  const others = new Set<number>();
  show.inputs.forEach((_, i) => {
    const p = portIn(i);
    if (!mine.has(i) && p !== null) others.add(p);
  });
  // 포트가 모자라 배정 못 하는 채널은 원래 포트를 그대로 갖고 있으므로 그 포트도 "사용 중"이다.
  // 앞에서부터 k개를 배정할 수 있는지, 남는 채널이 쥔 포트를 빼고 다시 세어 k를 줄여 간다.
  const freeFor = (k: number) => {
    const used = new Set(others);
    order.slice(k).forEach((i) => {
      const p = portIn(i);
      if (p !== null) used.add(p);
    });
    const free: number[] = [];
    for (let p = Math.max(1, startPort); p <= box.inputs; p++) if (!used.has(p)) free.push(p);
    return free;
  };
  let k = order.length;
  let free = freeFor(k);
  while (free.length < k) {
    k = free.length;
    free = freeFor(k);
  }
  const inputs = show.inputs.slice();
  order.slice(0, k).forEach((r, j) => {
    inputs[r] = { ...inputs[r], port: { kind: "stagebox", stageBoxId: boxId, port: free[j] } };
  });
  const assigned = k;
  const left = order.slice(k).map((r) => inputs[r].number);
  return { show: assigned ? { ...show, inputs } : show, assigned, left };
}

/* ───────────── 포트 교체 ───────────── */

/** 두 포트에 꽂힌 것을 서로 바꾼다 (한쪽이 비어 있으면 옮기기). 인풋끼리, 아웃풋끼리만. */
export function swapPorts(show: Show, a: PortAddr, b: PortAddr): Show {
  if (a.dir !== b.dir || (a.boxId === b.boxId && a.port === b.port)) return show;
  const to = (p: PortAddr): PortRef => refAt(p.boxId, p.port);
  const swap = (p: PortRef | null): PortRef | null =>
    isAt(p, a.boxId, a.port) ? to(b) : isAt(p, b.boxId, b.port) ? to(a) : p;
  if (a.dir === "in") {
    let changed = false;
    const inputs = show.inputs.map((c) => {
      const port = swap(c.port);
      if (port === c.port) return c;
      changed = true;
      return { ...c, port };
    });
    return changed ? { ...show, inputs } : show;
  }
  let changed = false;
  const outputs = show.outputs.map((bus) => {
    if (!bus.ports.some((p) => isAt(p, a.boxId, a.port) || isAt(p, b.boxId, b.port))) return bus;
    changed = true;
    return { ...bus, ports: bus.ports.map((p) => swap(p)!) };
  });
  return changed ? { ...show, outputs } : show;
}

/* ───────────── 스테이지박스 목록 ───────────── */

export function newStageBox(n: number): StageBox {
  return { id: newId(), name: `Box ${n}`, inputs: 16, outputs: 8, location: "" };
}

/**
 * 박스를 지우면 비워지는 패치 (지우기 전에 알려 주기용). 없으면 빈 배열.
 * 이름·위치·순서를 바꾸는 것은 패치가 박스 id를 가리키므로 아무것도 잃지 않는다.
 */
export function boxRemovalLoss(show: Show, ids: string[]): string[] {
  const gone = (p: PortRef | null) => p?.kind === "stagebox" && ids.includes(p.stageBoxId);
  const name = (p: PortRef) => (p.kind === "stagebox" ? `${show.stageBoxes.find((b) => b.id === p.stageBoxId)?.name ?? "?"} ${p.port}` : "");
  const out: string[] = [];
  for (const c of show.inputs) if (gone(c.port)) out.push(`Ch ${c.number} ${c.source} (${name(c.port!)})`);
  for (const b of show.outputs) {
    const ps = b.ports.filter(gone);
    if (ps.length) out.push(`${b.kind === "aux" ? "Aux" : b.kind === "matrix" ? "Matrix" : "Main"} ${b.number} ${b.name} (${ps.map(name).join(", ")})`);
  }
  return out;
}

/** 박스를 지우면 그 박스를 쓰던 채널 패치와 버스 출력도 비운다 (깨진 참조가 남지 않게) */
function withoutBoxes(show: Show, ids: string[]): Show {
  if (!ids.length) return show;
  const gone = (p: PortRef | null) => p?.kind === "stagebox" && ids.includes(p.stageBoxId);
  return {
    ...show,
    inputs: show.inputs.map((c) => (gone(c.port) ? { ...c, port: null } : c)),
    outputs: show.outputs.map((b) => (b.ports.some(gone) ? { ...b, ports: b.ports.filter((p) => !gone(p)) } : b)),
  };
}

const putBoxes = (show: Show, stageBoxes: StageBox[]): Show => ({ ...show, stageBoxes });

/** 표에서 쓰는 행 조작 (박스에는 번호가 없으므로 번호 다시 매기기는 없음) */
export const boxOps: RowOps = {
  count: (show) => show.stageBoxes.length,
  append: (show) => putBoxes(show, [...show.stageBoxes, newStageBox(show.stageBoxes.length + 1)]),
  insertAfter(show, index) {
    const list = show.stageBoxes.slice();
    list.splice(index + 1, 0, newStageBox(list.length + 1));
    return putBoxes(show, list);
  },
  duplicate(show, from, to) {
    const list = show.stageBoxes.slice();
    const copies = list.slice(from, to + 1).map((b) => ({ ...b, id: newId(), name: `${b.name} 사본` }));
    list.splice(to + 1, 0, ...copies);
    return putBoxes(show, list);
  },
  remove(show, from, to) {
    const list = show.stageBoxes.slice();
    const removed = list.splice(from, to - from + 1).map((b) => b.id);
    return withoutBoxes(putBoxes(show, list), removed);
  },
  move(show, from, to, insertBefore) {
    if (insertBefore >= from && insertBefore <= to + 1) return { show, start: from };
    const list = show.stageBoxes.slice();
    const block = list.splice(from, to - from + 1);
    const start = insertBefore > to ? insertBefore - block.length : insertBefore;
    list.splice(start, 0, ...block);
    return { show: putBoxes(show, list), start };
  },
};

/* ───────────── 스테이지박스 표의 열 ───────────── */

const setBox = (show: Show, i: number, patch: Partial<StageBox>): Show => {
  const list = show.stageBoxes.slice();
  list[i] = { ...list[i], ...patch };
  return putBoxes(show, list);
};
const count = (text: string) => {
  const m = text.match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
};

export function boxColumns(): SheetColumn<StageBox>[] {
  return [
    {
      key: "name",
      label: "이름",
      aliases: ["name", "box", "stagebox", "이름", "박스", "모델"],
      width: "min-w-32",
      text: (_s, b) => b.name,
      set: (show, i, text) => (text.trim() ? setBox(show, i, { name: text.trim() }) : null),
      suggestions: () => ["Rio3224", "Rio1608", "Rio3224-D2", "Rio1608-D2", "Tio1608-D", "Ri8-D", "Ro8-D", "DL32", "AD8HR"],
    },
    {
      key: "inputs",
      label: "인풋 수",
      aliases: ["inputs", "in", "ins", "인풋", "입력", "인풋수"],
      width: "w-20",
      text: (_s, b) => String(b.inputs),
      set: (show, i, text) => (count(text) >= 0 ? setBox(show, i, { inputs: count(text) }) : null),
    },
    {
      key: "outputs",
      label: "아웃풋 수",
      aliases: ["outputs", "out", "outs", "아웃풋", "출력", "아웃풋수"],
      width: "w-20",
      text: (_s, b) => String(b.outputs),
      set: (show, i, text) => (count(text) >= 0 ? setBox(show, i, { outputs: count(text) }) : null),
    },
    {
      key: "location",
      label: "무대 위 위치",
      aliases: ["location", "place", "position", "위치", "무대위치", "설치위치"],
      width: "min-w-48",
      text: (_s, b) => b.location,
      set: (show, i, text) => setBox(show, i, { location: text.trim() }),
      suggestions: () => ["무대 하수(SL)", "무대 상수(SR)", "무대 중앙 뒤(US)", "드럼 라이저 옆", "FOH", "모니터석"],
    },
    {
      key: "usage",
      label: "사용",
      aliases: [],
      width: "w-40",
      readOnly: true,
      text(show, b) {
        const u = boxUsage(show, b.id);
        return `인 ${u.ins.size}/${b.inputs} · 아웃 ${u.outs.size}/${b.outputs}`;
      },
      set: () => null,
    },
  ];
}

/* ───────────── 아웃풋 물리 출력 고르기 ───────────── */

export type OutPortChoice = { ref: PortRef; label: string; group: string; users: string[] };

const busTag = (b: OutputBus, side: number) =>
  `${b.kind === "aux" ? "Aux" : b.kind === "matrix" ? "Mtx" : "Main"} ${b.number}${b.width === "stereo" ? (side === 0 ? " L" : side === 1 ? " R" : "") : ""}`;

/**
 * 고를 수 있는 물리 출력: 모든 박스의 모든 출력 포트 + 콘솔 본체(OMNI OUT) + 쓰고 있는 Dante 직결.
 * 다른 버스가 쓰는 포트도 고를 수 있다(겹치면 오류 검사가 알려 줌). users에 지금 쓰는 버스를 적는다.
 */
export function outPortChoices(show: Show, exceptBusId?: string): OutPortChoice[] {
  const users = new Map<string, string[]>();
  const key = (p: PortRef) => (p.kind === "other" ? `o:${p.label}` : `${groupOf(p)}:${p.port}`);
  for (const b of show.outputs)
    b.ports.forEach((p, side) => {
      if (b.id === exceptBusId) return;
      users.set(key(p), [...(users.get(key(p)) ?? []), busTag(b, side)]);
    });
  const out: OutPortChoice[] = [];
  const push = (ref: PortRef, group: string) => out.push({ ref, label: formatOutLabel(show, ref), group, users: users.get(key(ref)) ?? [] });
  for (const b of show.stageBoxes) for (let n = 1; n <= b.outputs; n++) push(refAt(b.id, n), b.name);
  const omniMax = Math.max(OMNI_LIST, ...show.outputs.flatMap((b) => b.ports.flatMap((p) => (p.kind === "local" ? [p.port] : []))));
  for (let n = 1; n <= omniMax; n++) push(refAt(OMNI_BOX, n), "콘솔 본체 (OMNI OUT)");
  const dante = [...new Set(show.outputs.flatMap((b) => b.ports.flatMap((p) => (p.kind === "dante" ? [p.port] : []))))].sort((a, b) => a - b);
  for (const n of dante) push(refAt(DANTE_BOX, n), "Dante 직결");
  return out;
}

function formatOutLabel(show: Show, p: PortRef): string {
  if (p.kind === "stagebox") return `${show.stageBoxes.find((b) => b.id === p.stageBoxId)?.name ?? "?"} ${p.port}`;
  if (p.kind === "local") return `OMNI ${p.port}`;
  if (p.kind === "dante") return `Dante ${p.port}`;
  return p.label;
}

/**
 * 버스의 출력 중 side번째(스테레오 0 = L, 1 = R, 모노 0)를 바꾼다. ref가 null이면 그 자리를 비운다.
 * 출력은 빈칸 없는 목록이라, L을 비우고 R만 남기면 남은 출력이 첫 번째(L 자리)가 된다.
 */
export function setPortAt(ports: PortRef[], side: number, ref: PortRef | null): PortRef[] {
  const list: (PortRef | null)[] = ports.slice();
  while (list.length <= side) list.push(null);
  list[side] = ref;
  return list.filter((p): p is PortRef => p !== null);
}
