/**
 * 끌어다 놓기 패치 — 순수 함수 (Show → Show). 화면은 components/PatchView.
 *
 * - 놓는 것(유닛): 인풋 채널 하나, 또는 버스의 한쪽(모노 0 / 스테레오 L 0, R 1)
 * - 묶음(그룹): 연속한 포트에 함께 들어가야 하는 유닛들 — 스테레오 링크 채널 두 개, 스테레오 버스의 L·R
 * - 놓은 포트부터 차례로 채운다. 이미 다른 것이 있는 포트는 "덮어쓰기"(있던 것은 패치 해제) 또는 "건너뛰기"
 * - 끌고 있는 것들이 지금 쓰는 포트는 비어 있는 것으로 본다 (어차피 옮겨 가므로)
 *
 * 한 번 놓기 = Show 변경 한 번 → 실행 취소 한 번으로 돌아간다.
 */
import { busShort } from "./outputColumns";
import { DANTE_BOX, groupOf, OMNI_BOX, refAt, setPortAt, swapPorts, type PortAddr, type PortDir } from "./patch";
import type { PortRef, Show } from "./schema";

export type DropUnit = { dir: "in"; channelId: string } | { dir: "out"; busId: string; side: number };
export type DropGroup = DropUnit[];
export type DropMode = "overwrite" | "skip";

const unitKey = (u: DropUnit) => (u.dir === "in" ? `in:${u.channelId}` : `out:${u.busId}:${u.side}`);
const portKey = (p: PortRef) => (p.kind === "other" ? `o:${p.label}` : `${groupOf(p)}:${p.port}`);

/* ───────────── 끌 것 고르기 ───────────── */

/**
 * 채널 id들 → 묶음 목록 (채널 번호 순). 스테레오 링크된 채널은 짝을 함께 끌어 와 L·R 한 묶음으로.
 */
export function channelGroups(show: Show, ids: readonly string[]): DropGroup[] {
  const want = new Set(ids);
  const byNum = new Map(show.inputs.map((c) => [c.number, c]));
  for (const c of show.inputs) {
    if (!want.has(c.id)) continue;
    if (c.stereoLinkNext && byNum.get(c.number + 1)) want.add(byNum.get(c.number + 1)!.id);
    const prev = byNum.get(c.number - 1);
    if (prev?.stereoLinkNext) want.add(prev.id);
  }
  const chosen = show.inputs.filter((c) => want.has(c.id)).sort((a, b) => a.number - b.number);
  const out: DropGroup[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const c = chosen[i];
    const next = chosen[i + 1];
    if (c.stereoLinkNext && next && next.number === c.number + 1) {
      out.push([{ dir: "in", channelId: c.id }, { dir: "in", channelId: next.id }]);
      i++;
    } else out.push([{ dir: "in", channelId: c.id }]);
  }
  return out;
}

/** 버스 → 묶음. side를 주면 그 한쪽만(스테레오 L·R을 따로 옮기기), 없으면 스테레오는 L·R 한 묶음 */
export function busGroups(show: Show, busIds: readonly string[], side?: number): DropGroup[] {
  return show.outputs
    .filter((b) => busIds.includes(b.id))
    .map((b): DropGroup => {
      if (side !== undefined) return [{ dir: "out", busId: b.id, side }];
      return b.width === "stereo" ? [{ dir: "out", busId: b.id, side: 0 }, { dir: "out", busId: b.id, side: 1 }] : [{ dir: "out", busId: b.id, side: 0 }];
    });
}

/* ───────────── 포트 사용 현황 ───────────── */

/** 그 방향의 포트 → 쓰고 있는 유닛들 */
function occupancy(show: Show, dir: PortDir): Map<string, DropUnit[]> {
  const m = new Map<string, DropUnit[]>();
  const add = (p: PortRef, u: DropUnit) => m.set(portKey(p), [...(m.get(portKey(p)) ?? []), u]);
  if (dir === "in") show.inputs.forEach((c) => c.port && add(c.port, { dir: "in", channelId: c.id }));
  else show.outputs.forEach((b) => b.ports.forEach((p, side) => add(p, { dir: "out", busId: b.id, side })));
  return m;
}

/** 묶음(박스) 안의 포트 수 (박스 없는 OMNI·Dante 직결은 제한 없음) */
function capacity(show: Show, dir: PortDir, boxId: string): number {
  if (boxId === OMNI_BOX || boxId === DANTE_BOX) return Number.POSITIVE_INFINITY;
  const box = show.stageBoxes.find((b) => b.id === boxId);
  return box ? (dir === "in" ? box.inputs : box.outputs) : 0;
}

/** 표시용 이름: "Ch 3 Snare", "Aux 5 L" */
export function unitLabel(show: Show, u: DropUnit): string {
  if (u.dir === "in") {
    const c = show.inputs.find((x) => x.id === u.channelId);
    return c ? `Ch ${c.number}${c.source ? ` ${c.source}` : ""}` : "?";
  }
  const b = show.outputs.find((x) => x.id === u.busId);
  if (!b) return "?";
  return `${busShort(b)}${b.width === "stereo" ? (u.side === 0 ? " L" : " R") : ""}`;
}

/* ───────────── 놓기 계획 ───────────── */

export interface DropPlan {
  placements: { unit: DropUnit; port: number }[];
  /** 덮어쓰면 패치가 해제되는 것들 (overwrite일 때만) */
  displaced: { unit: DropUnit; port: number }[];
  /** 포트가 모자라 놓지 못한 유닛 수 */
  left: number;
}

/**
 * groups를 boxId의 start 포트부터 차례로 놓는 계획.
 * - overwrite: 순서대로 붙여 넣고, 그 포트에 있던 것(끌고 있지 않은 것)은 패치 해제
 * - skip: 다른 것이 있는 포트는 건너뛴다 (스테레오 묶음은 빈 포트 두 개가 이어진 곳에)
 */
export function planDrop(show: Show, dir: PortDir, groups: readonly DropGroup[], boxId: string, start: number, mode: DropMode): DropPlan {
  const occ = occupancy(show, dir);
  const moving = new Set(groups.flat().map(unitKey));
  const cap = capacity(show, dir, boxId);
  const others = (port: number) => (occ.get(portKey(refAt(boxId, port))) ?? []).filter((u) => !moving.has(unitKey(u)));
  const plan: DropPlan = { placements: [], displaced: [], left: 0 };
  let p = Math.max(1, start);
  let full = false;
  groups.forEach((g) => {
    if (full) return void (plan.left += g.length);
    for (;;) {
      if (p + g.length - 1 > cap) {
        full = true;
        plan.left += g.length;
        return;
      }
      const ports = g.map((_, k) => p + k);
      if (mode === "skip" && ports.some((q) => others(q).length)) {
        p++;
        continue;
      }
      g.forEach((unit, k) => plan.placements.push({ unit, port: ports[k] }));
      if (mode === "overwrite") for (const q of ports) for (const u of others(q)) plan.displaced.push({ unit: u, port: q });
      p += g.length;
      return;
    }
  });
  return plan;
}

/** 덮어쓰기로 놓으면 패치가 해제될 것들 (묻기용). 없으면 빈 배열 */
export function dropConflicts(show: Show, dir: PortDir, groups: readonly DropGroup[], boxId: string, start: number): DropPlan["displaced"] {
  return planDrop(show, dir, groups, boxId, start, "overwrite").displaced;
}

/* ───────────── 적용 ───────────── */

/** 유닛들의 패치 해제 (버스는 높은 쪽부터 지워야 L·R 자리가 섞이지 않는다) */
export function unpatchUnits(show: Show, units: readonly DropUnit[]): Show {
  const chIds = new Set(units.flatMap((u) => (u.dir === "in" ? [u.channelId] : [])));
  const sides = new Map<string, number[]>();
  for (const u of units) if (u.dir === "out") sides.set(u.busId, [...(sides.get(u.busId) ?? []), u.side]);
  if (!chIds.size && !sides.size) return show;
  let changed = false;
  const inputs = show.inputs.map((c) => {
    if (!chIds.has(c.id) || !c.port) return c;
    changed = true;
    return { ...c, port: null };
  });
  const outputs = show.outputs.map((b) => {
    const ss = sides.get(b.id);
    if (!ss) return b;
    let ports = b.ports;
    for (const side of [...new Set(ss)].sort((x, y) => y - x)) if (side < ports.length) ports = setPortAt(ports, side, null);
    if (ports === b.ports) return b;
    changed = true;
    return { ...b, ports };
  });
  return changed ? { ...show, inputs, outputs } : show;
}

/** 계획대로 놓기: 덮인 것 해제 → 놓을 것 배정 */
export function applyDrop(show: Show, dir: PortDir, plan: DropPlan, boxId: string): Show {
  if (!plan.placements.length) return show;
  let s = unpatchUnits(show, plan.displaced.map((d) => d.unit));
  if (dir === "in") {
    const at = new Map(plan.placements.map((x) => [(x.unit as { channelId: string }).channelId, x.port]));
    s = { ...s, inputs: s.inputs.map((c) => (at.has(c.id) ? { ...c, port: refAt(boxId, at.get(c.id)!) } : c)) };
    return s;
  }
  const byBus = new Map<string, { side: number; port: number }[]>();
  for (const x of plan.placements) {
    const u = x.unit as { busId: string; side: number };
    byBus.set(u.busId, [...(byBus.get(u.busId) ?? []), { side: u.side, port: x.port }]);
  }
  return {
    ...s,
    outputs: s.outputs.map((b) => {
      const list = byBus.get(b.id);
      if (!list) return b;
      let ports = b.ports;
      for (const { side, port } of list.sort((x, y) => x.side - y.side)) ports = setPortAt(ports, side, refAt(boxId, port));
      return { ...b, ports };
    }),
  };
}

/** 한 번에: 계획 + 적용 */
export function dropGroups(show: Show, dir: PortDir, groups: readonly DropGroup[], boxId: string, start: number, mode: DropMode) {
  const plan = planDrop(show, dir, groups, boxId, start, mode);
  return { show: applyDrop(show, dir, plan, boxId), plan };
}

/**
 * 서로 바꾸기: 유닛 하나를 다른 것이 있는 포트에 놓고, 있던 것은 끌어 온 유닛의 원래 포트로.
 * 끌어 온 유닛이 패치 안 된 상태(또는 자유 텍스트 포트)였으면 있던 것은 패치 해제(= 교체와 같음).
 */
export function swapUnitInto(show: Show, dir: PortDir, unit: DropUnit, boxId: string, port: number): Show {
  const from = currentPort(show, unit);
  const plan = planDrop(show, dir, [[unit]], boxId, port, "overwrite");
  let s = applyDrop(show, dir, plan, boxId);
  if (!from || from.kind === "other") return s;
  // 해제됐던 것들을 원래 포트로
  for (const d of plan.displaced) {
    if (d.unit.dir === "in") {
      const id = d.unit.channelId;
      s = { ...s, inputs: s.inputs.map((c) => (c.id === id ? { ...c, port: from } : c)) };
    } else {
      const { busId, side } = d.unit;
      s = { ...s, outputs: s.outputs.map((b) => (b.id === busId ? { ...b, ports: setPortAt(b.ports, side, from) } : b)) };
    }
  }
  return s;
}

export function currentPort(show: Show, u: DropUnit): PortRef | null {
  if (u.dir === "in") return show.inputs.find((c) => c.id === u.channelId)?.port ?? null;
  return show.outputs.find((b) => b.id === u.busId)?.ports[u.side] ?? null;
}

/** 포트(현황판 칸)에 있는 유닛들 — 칸을 목록으로 끌어내 해제할 때 */
export function unitsAt(show: Show, dir: PortDir, boxId: string, port: number): DropUnit[] {
  return occupancy(show, dir).get(portKey(refAt(boxId, port))) ?? [];
}

/**
 * 포트 → 포트 교체: from 포트에 있던 것을 to 포트로 옮기고, to 포트에 있던 것은 패치 해제.
 * (서로 바꾸기는 patch.swapPorts)
 */
export function replacePort(show: Show, from: PortAddr, to: PortAddr): Show {
  if (from.dir !== to.dir || (from.boxId === to.boxId && from.port === to.port)) return show;
  const moving = new Set(unitsAt(show, from.dir, from.boxId, from.port).map(unitKey));
  const displaced = unitsAt(show, to.dir, to.boxId, to.port).filter((u) => !moving.has(unitKey(u)));
  return swapPorts(unpatchUnits(show, displaced), from, to);
}
