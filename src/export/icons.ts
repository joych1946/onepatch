/**
 * 채널 아이콘 고르기 (기종 값은 콘솔 프로필에서).
 * 1) 내 소스 목록에서 같은 이름의 소스를 찾으면 그 소스·악기군의 지정 아이콘
 * 2) 보컬로 보이는 이름이면 보컬 아이콘 (무선 마이크면 무선 아이콘)
 * 3) 이름 규칙
 * 4) 맞는 것이 없으면 Blank
 */
import type { InputChannel, Show } from "@/model/schema";
import type { SourceDef } from "@/model/library";
import { norm } from "@/model/text";
import type { ConsoleProfile } from "./profile";

/** "Keys 1 L" → "Keys", "가야금 2" → "가야금" */
const stripSuffix = (s: string) => s.trim().replace(/(\s*(\d+|[LR]))+$/i, "").trim();

export function findSource(ch: Pick<InputChannel, "source" | "shortName">, sources: readonly SourceDef[]): SourceDef | undefined {
  const keys = new Set([ch.source, stripSuffix(ch.source)].map(norm).filter(Boolean));
  return sources.find((s) => keys.has(norm(s.name)));
}

export function pickIcon(profile: ConsoleProfile, show: Show, ch: InputChannel, sources: readonly SourceDef[] = []): string {
  const ok = (icon: string | undefined) => (icon && profile.icons.includes(icon) ? icon : undefined);
  const src = findSource(ch, sources);
  const mic = ch.mic?.kind === "library" ? show.microphones.find((m) => m.id === (ch.mic as { microphoneId: string }).microphoneId) : undefined;
  const vocal = () => (mic?.type === "wireless" ? profile.iconWireless : profile.iconVocal);
  if (src) {
    const icon = ok(profile.iconBySource[src.id]) ?? ok(profile.iconByGroup[src.groupId]);
    if (icon) return icon;
  }
  const texts = [src?.name, ch.source, ch.shortName].filter((t): t is string => !!t?.trim());
  if (texts.some((t) => new RegExp(profile.vocalPattern, "i").test(t))) return ok(vocal()) ?? profile.iconBlank;
  for (const t of texts)
    for (const [re, icon] of profile.iconRules) if (new RegExp(re, "i").test(t) && ok(icon)) return icon;
  return profile.iconBlank;
}
