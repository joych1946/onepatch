/**
 * 아웃풋(Aux/Matrix/Main)과 DCA·뮤트 그룹 표의 열 정의.
 * 인풋 그리드처럼 "표시 텍스트 ↔ 데이터" 변환을 열마다 가져, 키보드 입력과 엑셀 붙여넣기가 같은 결과를 낸다.
 */
import { BUS_PRESETS } from "./busPresets";
import { DANTE_PREFIX, LOCAL_PREFIX, matchStageBox } from "./inputColumns";
import { BUS_PURPOSE_LABEL, formatPort } from "./labels";
import {
  busesOf,
  formatRanges,
  groupMembers,
  groupsOf,
  parseRanges,
  putBuses,
  setGroupMembers,
  updateBus,
  type GroupKind,
} from "./outputOps";
import type { BusKind, BusPurpose, Dca, MuteGroup, OutputBus, PortRef, Show } from "./schema";
import type { SheetColumn } from "./sheet";
import { norm } from "./text";

/* ───────────── 값 해석 ───────────── */

const PURPOSE_ALIASES: Record<BusPurpose, string[]> = {
  wedge: ["wedge", "wdg", "mon", "monitor", "웨지", "모니터"],
  iem: ["iem", "inear", "ear", "인이어"],
  sidefill: ["sidefill", "side", "sf", "사이드", "사이드필"],
  fx: ["fx", "effect", "efx", "이펙트", "이펙터"],
  pa: ["pa", "main", "메인", "메인pa"],
  sub: ["sub", "subwoofer", "서브", "서브우퍼"],
  frontfill: ["frontfill", "front", "ff", "fill", "프런트필", "프론트필", "프런트", "프론트"],
  delay: ["delay", "dly", "delayspk", "딜레이", "딜레이스피커"],
  record: ["record", "rec", "recording", "녹음"],
  broadcast: ["broadcast", "bcast", "bc", "중계", "방송"],
  lobby: ["lobby", "로비"],
  other: ["other", "etc", "기타"],
};

export function parsePurpose(text: string): BusPurpose | undefined {
  const n = norm(text);
  if (!n) return "other";
  for (const [k, list] of Object.entries(PURPOSE_ALIASES) as [BusPurpose, string[]][])
    if (list.some((a) => norm(a) === n)) return k;
  return undefined;
}

export function parseWidth(text: string): OutputBus["width"] | undefined {
  const t = norm(text);
  if (/^(s|st|stereo|스테레오|lr|on|y|o|1|✓)$/.test(t)) return "stereo";
  if (/^(m|mono|모노|off|n|x|0|)$/.test(t)) return "mono";
  return undefined;
}

export function parseTap(text: string): OutputBus["tap"] | undefined {
  const t = norm(text);
  if (/^(pre|p|프리|on|y|o|1|✓|prefader|prefdr)$/.test(t)) return "pre";
  if (/^(post|포스트|off|n|x|0|postfader|postfdr)$/.test(t)) return "post";
  return undefined;
}

/** 출력 포트 텍스트: "Rio3224 5-6", "Rio3224 5, 7", "L1, L2", "5"(윗 버스와 같은 박스) */
export function parseOutPorts(show: Show, kind: BusKind, index: number, text: string): PortRef[] {
  const tokens = text.split(/[,/&]+/).map((t) => t.trim()).filter((t) => t && t !== "-");
  const prevBus = busesOf(show, kind)[index - 1]?.ports.findLast((p) => p.kind === "stagebox");
  let lastBox: string | undefined = prevBus?.kind === "stagebox" ? prevBus.stageBoxId : show.stageBoxes[0]?.id;
  const out: PortRef[] = [];
  for (const tok of tokens) {
    const m = tok.match(/^(.*?)[\s:#.]*(\d+)(?:\s*[-~–]\s*(\d+))?$/);
    if (!m) {
      out.push({ kind: "other", label: tok });
      continue;
    }
    let prefix = m[1];
    let a = parseInt(m[2], 10);
    let b = m[3] ? parseInt(m[3], 10) : a;
    // "1608-3"처럼 박스-포트 표기: 뒤 숫자가 앞보다 작으면 범위가 아니다
    if (m[3] && b < a) {
      prefix = `${prefix}${m[2]}`;
      a = b;
      b = parseInt(m[3], 10);
    }
    const p = norm(prefix);
    const ports = Array.from({ length: Math.min(b - a, 63) + 1 }, (_, i) => a + i).filter((x) => x >= 1);
    if (LOCAL_PREFIX.test(p) || DANTE_PREFIX.test(p)) {
      const k = LOCAL_PREFIX.test(p) ? ("local" as const) : ("dante" as const);
      out.push(...ports.map((port) => ({ kind: k, port })));
      continue;
    }
    const box = p ? matchStageBox(show, p) : show.stageBoxes.find((x) => x.id === lastBox);
    if (!box) {
      out.push({ kind: "other", label: tok });
      continue;
    }
    lastBox = box.id;
    out.push(...ports.map((port) => ({ kind: "stagebox" as const, stageBoxId: box.id, port })));
  }
  return out;
}

/** 포트 목록 → "Rio3224 5-6", "Rio3224 5, 7", "OMNI 1-2", "Dante 9" */
export function formatOutPorts(show: Show, ports: PortRef[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < ports.length) {
    const p = ports[i];
    if (p.kind === "other") {
      parts.push(formatPort(p, show.stageBoxes));
      i++;
      continue;
    }
    const same = (q: PortRef) =>
      q.kind === p.kind && (q.kind !== "stagebox" || (p.kind === "stagebox" && q.stageBoxId === p.stageBoxId));
    const nums: number[] = [];
    while (i < ports.length && same(ports[i])) {
      nums.push((ports[i] as { port: number }).port);
      i++;
    }
    const head = p.kind === "local" ? "OMNI" : p.kind === "dante" ? "Dante" : (show.stageBoxes.find((b) => b.id === p.stageBoxId)?.name ?? "?");
    const ranges: string[] = [];
    for (let k = 0; k < nums.length; k++) {
      let j = k;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      ranges.push(j > k ? `${nums[k]}-${nums[j]}` : `${nums[k]}`);
      k = j;
    }
    parts.push(`${head} ${ranges.join(", ")}`);
  }
  return parts.join(", ");
}

/** Matrix 소스 표시: Main은 이름, 나머지는 "Aux 5" */
export function busShort(b: OutputBus): string {
  if (b.kind === "main") return b.name || `Main ${b.number}`;
  return `${b.kind === "aux" ? "Aux" : "Mtx"} ${b.number}`;
}

/** "Main L/R, Aux 5" → 버스 id들 (모르는 이름이 있으면 null) */
export function parseBusRefs(show: Show, text: string): string[] | null {
  const ids: string[] = [];
  for (const tok of text.split(/[,;]+/).map((t) => t.trim()).filter(Boolean)) {
    const n = norm(tok);
    const m = n.match(/^(aux|mix|a|mtx|matrix|mx)(\d+)$/);
    let bus: OutputBus | undefined;
    if (m) {
      const kind: BusKind = /^(mtx|matrix|mx)$/.test(m[1]) ? "matrix" : "aux";
      bus = busesOf(show, kind).find((b) => b.number === parseInt(m[2], 10));
    } else {
      const mains = busesOf(show, "main");
      bus =
        show.outputs.find((b) => norm(b.name) === n) ??
        (/^(main|mainlr|lr|st|stereo|메인)$/.test(n) ? mains.find((b) => b.width === "stereo") ?? mains[0] : undefined) ??
        (/^(mono|sub|monosub|m|모노|서브)$/.test(n) ? mains.find((b) => b.width === "mono") : undefined);
    }
    if (!bus) return null;
    if (!ids.includes(bus.id)) ids.push(bus.id);
  }
  return ids;
}

/* ───────────── 버스 열 ───────────── */

export function busColumns(kind: BusKind): SheetColumn<OutputBus>[] {
  const up = (show: Show, i: number, patch: Partial<OutputBus>) => updateBus(show, kind, i, patch);
  const num: SheetColumn<OutputBus> = {
    key: "num",
    label: kind === "main" ? "#" : "번호",
    aliases: ["no", "num", "number", "bus", "#", "번호", kind === "aux" ? "aux" : kind === "matrix" ? "mtx" : "main", "mix"],
    width: "w-14",
    pick: true,
    noClear: true,
    text: (_s, b) => String(b.number),
    set(show, i, text) {
      const m = text.match(/\d+/);
      const n = m ? parseInt(m[0], 10) : NaN;
      return n >= 1 ? up(show, i, { number: n }) : null;
    },
  };
  const name: SheetColumn<OutputBus> = {
    key: "name",
    label: "이름",
    aliases: ["name", "label", "이름", "버스명", "명칭", "destination", "dest"],
    width: "min-w-36",
    text: (_s, b) => b.name,
    set: (show, i, text) => up(show, i, { name: text.trim() }),
    suggestions: () => [...new Set(BUS_PRESETS[kind].map((p) => p.name))],
  };
  const purpose: SheetColumn<OutputBus> = {
    key: "purpose",
    label: "용도",
    aliases: ["purpose", "use", "type", "용도", "종류"],
    width: "w-24",
    text: (_s, b) => (b.purpose === "other" ? "" : BUS_PURPOSE_LABEL[b.purpose]),
    set(show, i, text) {
      const p = parsePurpose(text);
      return p ? up(show, i, { purpose: p }) : null;
    },
    suggestions: () => Object.values(BUS_PURPOSE_LABEL),
  };
  const width: SheetColumn<OutputBus> = {
    key: "width",
    label: "M/S",
    aliases: ["ms", "m/s", "st", "s/m", "width", "stereo", "mono", "모노스테레오", "채널"],
    width: "w-16",
    toggle: { value: (b) => b.width === "stereo", on: "Stereo", off: "Mono" },
    text: (_s, b) => (b.width === "stereo" ? "Stereo" : "Mono"),
    set(show, i, text) {
      const w = parseWidth(text);
      return w ? up(show, i, { width: w }) : null;
    },
  };
  const tap: SheetColumn<OutputBus> = {
    key: "tap",
    label: "Pre/Post",
    aliases: ["prepost", "pre/post", "tap", "send", "프리포스트", "탭"],
    width: "w-16",
    toggle: { value: (b) => b.tap === "pre", on: "Pre", off: "Post" },
    text: (_s, b) => (b.tap === "pre" ? "Pre" : "Post"),
    set(show, i, text) {
      const t = parseTap(text);
      return t ? up(show, i, { tap: t }) : null;
    },
  };
  const sources: SheetColumn<OutputBus> = {
    key: "sources",
    label: "소스",
    aliases: ["source", "sources", "from", "input", "소스", "입력", "받는버스"],
    width: "min-w-32",
    text: (s, b) => b.sources.map((id) => s.outputs.find((x) => x.id === id)).filter(Boolean).map((x) => busShort(x!)).join(", "),
    set(show, i, text) {
      const ids = parseBusRefs(show, text);
      return ids ? up(show, i, { sources: ids }) : null;
    },
    suggestions: (s) => s.outputs.filter((b) => b.kind !== "matrix").map(busShort),
  };
  const ports: SheetColumn<OutputBus> = {
    key: "ports",
    label: "물리 출력",
    aliases: ["port", "ports", "output", "out", "patch", "물리출력", "출력", "출력포트", "포트", "패치"],
    width: "min-w-36",
    text: (s, b) => formatOutPorts(s, b.ports),
    set: (show, i, text) => up(show, i, { ports: parseOutPorts(show, kind, i, text) }),
  };
  const notes: SheetColumn<OutputBus> = {
    key: "notes",
    label: "비고",
    aliases: ["notes", "note", "memo", "comment", "비고", "메모"],
    width: "min-w-40",
    text: (_s, b) => b.notes,
    set: (show, i, text) => up(show, i, { notes: text.trim() }),
  };
  if (kind === "aux") return [num, name, purpose, width, tap, ports, notes];
  if (kind === "matrix") return [num, name, purpose, width, sources, ports, notes];
  return [num, name, purpose, width, ports, notes];
}

/** 검증 경로(outputs, i, field) → 표의 행·열 */
export function busIssueCell(show: Show, path: PropertyKey[]): { kind: BusKind; row: number; col: string } | null {
  if (path[0] !== "outputs" || typeof path[1] !== "number") return null;
  const bus = show.outputs[path[1]];
  if (!bus) return null;
  const row = busesOf(show, bus.kind).indexOf(bus);
  const field = String(path[2] ?? "name");
  const col = field === "number" ? "num" : field;
  return { kind: bus.kind, row, col };
}

export { putBuses };

/* ───────────── DCA·뮤트 그룹 열 ───────────── */

export function groupColumns(k: GroupKind): SheetColumn<Dca | MuteGroup>[] {
  const key = k === "dca" ? "dcas" : "muteGroups";
  const up = (show: Show, i: number, patch: Partial<Dca>) => {
    const list = groupsOf(show, k).slice();
    list[i] = { ...list[i], ...patch };
    return { ...show, [key]: list };
  };
  return [
    {
      key: "num",
      label: "번호",
      aliases: ["no", "num", "number", "#", "번호", k === "dca" ? "dca" : "mute"],
      width: "w-14",
      noClear: true,
      text: (_s, g) => String(g.number),
      set(show, i, text) {
        const m = text.match(/\d+/);
        const n = m ? parseInt(m[0], 10) : NaN;
        return n >= 1 ? up(show, i, { number: n }) : null;
      },
    },
    {
      key: "name",
      label: "이름",
      aliases: ["name", "이름", "label"],
      width: "w-40",
      text: (_s, g) => g.name,
      set: (show, i, text) => up(show, i, { name: text.trim() }),
      suggestions: () =>
        k === "dca"
          ? ["Drums", "Bass", "Gtr", "Keys", "Vox", "BGV", "Brass", "Strings", "FX", "MC", "Band"]
          : ["Band", "Vox", "MC", "FX", "Playback", "All"],
    },
    {
      key: "members",
      label: "멤버 (채널)",
      aliases: ["members", "member", "channels", "ch", "멤버", "채널"],
      width: "min-w-64",
      pick: true,
      text: (s, g) => formatRanges(groupMembers(s, k, g.id)),
      set(show, i, text) {
        const nums = parseRanges(text);
        return nums ? setGroupMembers(show, k, groupsOf(show, k)[i].id, nums) : null;
      },
    },
  ];
}
