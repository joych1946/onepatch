/**
 * 콘솔 내보내기 전 점검 (기종 값은 콘솔 프로필에서).
 * - 이름이 글자 수를 넘음 → 줄인 이름 제안, 그 자리에서 고치기(applyNameFix)
 * - 콘솔에 없는 컬러 → 가까운 컬러 제안, 사용자가 고르면 해결(내보내기 설정 colorMap)
 * - 채널·버스·DCA·뮤트 그룹 수가 기종 한도를 넘음
 * - 5단계 오류 검사에 남은 경고 (짧은 이름 초과는 위의 이름 점검과 겹치므로 뺀다)
 */
import type { BusKind, Color, Show } from "@/model/schema";

/** 오류 검사 결과 한 건 (checkShow·quantityIssues) */
export type CheckIssue = { path: readonly PropertyKey[]; message: string; code?: string };
import { suggestShortName } from "@/model/text";
import { COLOR_LABEL } from "@/model/labels";
import { busesOf } from "@/model/outputOps";
import type { ConsoleProfile } from "./profile";

export type NameRef = { kind: "input" | "bus" | "dca" | "mute"; id: string };

export type ExportCheck =
  | { kind: "name"; key: string; ref: NameRef; target: string; current: string; suggestion: string }
  | { kind: "color"; key: string; color: Exclude<Color, "none">; label: string; channels: number[]; suggestion: string }
  | { kind: "limit"; key: string; message: string }
  | { kind: "issue"; key: string; message: string; path: readonly PropertyKey[] };

const BUS_LABEL: Record<BusKind, string> = { aux: "Aux", matrix: "Matrix", main: "Main" };
const len = (s: string) => [...s].length;

/** 스테레오 버스는 홀수에서 시작하는 두 개를 쓴다고 보고 필요한 버스 수 */
function slotsNeeded(show: Show, kind: BusKind): number {
  let next = 1;
  for (const b of busesOf(show, kind)) {
    if (b.width === "stereo" && next % 2 === 0) next++;
    next += b.width === "stereo" ? 2 : 1;
  }
  return next - 1;
}

export function exportChecks(
  show: Show,
  profile: ConsoleProfile,
  opts: { colorMap?: Partial<Record<Color, string>>; issues?: readonly CheckIssue[] } = {},
): ExportCheck[] {
  const out: ExportCheck[] = [];
  const max = profile.nameMax;
  const name = (ref: NameRef, target: string, current: string) => {
    if (len(current.trim()) > max) out.push({ kind: "name", key: `name:${ref.kind}:${ref.id}`, ref, target, current, suggestion: suggestShortName(current, max) });
  };

  // 이름
  for (const ch of show.inputs) name({ kind: "input", id: ch.id }, `Ch ${ch.number}`, ch.shortName || ch.source);
  for (const b of show.outputs) name({ kind: "bus", id: b.id }, `${BUS_LABEL[b.kind]} ${b.number}`, b.name);
  for (const d of show.dcas) name({ kind: "dca", id: d.id }, `DCA ${d.number}`, d.name);
  for (const g of show.muteGroups) name({ kind: "mute", id: g.id }, `뮤트 그룹 ${g.number}`, g.name);

  // 컬러
  const used = new Map<Exclude<Color, "none">, number[]>();
  for (const ch of show.inputs) if (ch.color !== "none") used.set(ch.color, [...(used.get(ch.color) ?? []), ch.number]);
  for (const [color, channels] of used) {
    const m = profile.colorMap[color];
    const picked = opts.colorMap?.[color];
    if (m.approx && !(picked && profile.colors.some((c) => c.value === picked)))
      out.push({ kind: "color", key: `color:${color}`, color, label: COLOR_LABEL[color], channels, suggestion: m.value });
  }

  // 기종 한도
  const limit = (key: string, message: string) => out.push({ kind: "limit", key: `limit:${key}`, message });
  const overCh = show.inputs.filter((c) => c.number > profile.inputs).map((c) => c.number);
  if (overCh.length) limit("inputs", `${profile.name}의 인풋은 ${profile.inputs}채널까지입니다. Ch ${overCh.join(", ")}은(는) 넣을 수 없습니다.`);
  const mixes = slotsNeeded(show, "aux");
  if (mixes > profile.mixes) limit("mixes", `Aux가 Mix ${mixes}개 분량(스테레오는 2개)으로 ${profile.name}의 ${profile.mixes}개를 넘습니다.`);
  const mats = slotsNeeded(show, "matrix");
  if (mats > profile.matrices) limit("matrices", `Matrix가 ${mats}개 분량(스테레오는 2개)으로 ${profile.name}의 ${profile.matrices}개를 넘습니다.`);
  const mains = busesOf(show, "main");
  if (mains.length > profile.mains) limit("mains", `Main이 ${mains.length}개로 ${profile.name}의 Stereo ${profile.mains}개를 넘습니다. ${profile.mains + 1}번째부터는 넣을 수 없습니다.`);
  const overDca = show.dcas.filter((d) => d.number > profile.dcas).map((d) => d.number);
  if (overDca.length) limit("dcas", `${profile.name}의 DCA는 ${profile.dcas}개까지입니다. DCA ${overDca.join(", ")}은(는) 넣을 수 없습니다.`);
  const overMute = show.muteGroups.filter((g) => g.number > profile.muteGroups).map((g) => g.number);
  if (overMute.length) limit("mutes", `${profile.name}의 뮤트 그룹은 ${profile.muteGroups}개까지입니다. 뮤트 그룹 ${overMute.join(", ")}은(는) 넣을 수 없습니다.`);

  // 5단계 오류 검사의 경고
  (opts.issues ?? []).forEach((i, k) => {
    if (i.code !== "short-name") out.push({ kind: "issue", key: `issue:${k}:${i.path.map(String).join(".")}`, message: i.message, path: i.path });
  });
  return out;
}

/** 점검 화면에서 고친 이름을 Show에 넣는다 (채널은 짧은 이름, 나머지는 이름) */
export function applyNameFix(show: Show, ref: NameRef, name: string): Show {
  const v = name.trim();
  if (!v) return show;
  switch (ref.kind) {
    case "input":
      return { ...show, inputs: show.inputs.map((c) => (c.id === ref.id ? { ...c, shortName: v } : c)) };
    case "bus":
      return { ...show, outputs: show.outputs.map((b) => (b.id === ref.id ? { ...b, name: v } : b)) };
    case "dca":
      return { ...show, dcas: show.dcas.map((d) => (d.id === ref.id ? { ...d, name: v } : d)) };
    case "mute":
      return { ...show, muteGroups: show.muteGroups.map((g) => (g.id === ref.id ? { ...g, name: v } : g)) };
  }
}
