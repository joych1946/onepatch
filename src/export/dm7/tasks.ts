/**
 * "콘솔에서 직접 할 일" 체크리스트 (DM7).
 * 쇼 파일로 넣지 못하는 것(게인, HPF·EQ·다이내믹스, 버스의 스테레오 설정, Aux 프리/포스트, Matrix 소스 등)을
 * Show 내용에 맞춰 뽑는다. 인쇄 화면의 출력물 하나로 쓴다.
 */
import type { Show } from "@/model/schema";
import { micName, resolvePhantom } from "@/model/derive";
import { BUS_PURPOSE_LABEL } from "@/model/labels";
import { phantomChecklist } from "@/model/reports";
import { busesOf } from "@/model/outputOps";
import { DEFAULT_CONSOLE_PROFILE, type ConsoleProfile } from "../profile";
import { allocateBuses } from "./dm7Export";

export interface ConsoleTask {
  section: string;
  target: string;
  task: string;
  note?: string;
}

export const TASK_SECTIONS = ["준비", "인풋 (사운드체크)", "버스·출력", "마무리"] as const;

export function consoleTasks(show: Show, profile: ConsoleProfile = DEFAULT_CONSOLE_PROFILE): ConsoleTask[] {
  const out: ConsoleTask[] = [];
  const add = (section: (typeof TASK_SECTIONS)[number], target: string, task: string, note?: string) => out.push({ section, target, task, note });

  /* 준비 */
  add("준비", "쇼 파일", "OnePatch에서 내보낸 파일을 DM Editor로 열어 확인 → USB로 콘솔에 Load", "불러오기 전에 앰프·모니터 볼륨을 내린다");
  for (const b of show.stageBoxes)
    add("준비", b.name, `Dante 연결 확인: 입력 ${b.inputs}개 → 콘솔, 콘솔 → 출력 ${b.outputs}개 (Dante Controller 라우팅)`, `UNIT ID가 내보내기 설정의 I/O 유닛 번호와 같은지 · ${b.location}`.trim().replace(/ · $/, ""));
  const names = [...show.inputs.map((c) => c.shortName || c.source), ...show.outputs.map((b) => b.name), ...show.dcas.map((d) => d.name), ...show.muteGroups.map((g) => g.name)];
  if (names.some((n) => /[^\x20-\x7e]/.test(n))) add("준비", "SETUP", "Name Language를 한국어로", "한글 이름이 있음");
  const over = show.inputs.filter((c) => c.number > profile.inputs);
  if (over.length) add("준비", `Ch ${over.map((c) => c.number).join(", ")}`, `${profile.name} 인풋 ${profile.inputs}채널을 넘어 파일에 넣지 못함 — 다른 방법으로 처리`);

  /* 48V: 내보내기 기본값은 끄기 — 마이크를 꽂은 뒤 체크리스트대로 켠다 */
  const phantom = phantomChecklist(show);
  if (phantom.on.length)
    add(
      "인풋 (사운드체크)",
      "48V",
      `48V 켜기 ${phantom.on.length}채널 — 48V 체크리스트 참고`,
      [
        "마이크·DI를 모두 꽂은 뒤",
        phantom.never.length ? `리본 등 ${phantom.never.length}채널(Ch ${phantom.never.map((r) => r.cells.ch).join(", ")})은 켜지 않음` : "",
        "내보내기에서 “시트대로 켜기”를 골랐다면 이미 켜져 있음",
      ]
        .filter(Boolean)
        .join(" · "),
    );

  /* 인풋: 채널마다 게인·HPF·EQ·다이내믹스 */
  for (const ch of show.inputs) {
    if (!ch.source.trim() && !ch.port) continue;
    const mic = micName(show, ch);
    const extra = [mic, resolvePhantom(show, ch) ? "48V" : "", ch.stereoLinkNext ? `${ch.number}/${ch.number + 1} 페어` : ""].filter(Boolean).join(" · ");
    add("인풋 (사운드체크)", `Ch ${ch.number} ${ch.shortName || ch.source}`, "게인 · HPF · EQ · 다이내믹스", extra || undefined);
  }

  /* 버스·출력 */
  const noop = () => {};
  const alloc = allocateBuses(show, { warn: noop, note: noop }, profile);
  const label = new Map(alloc.map((a) => [a.bus.id, a.label]));
  for (const a of alloc)
    if (a.sources.length === 2 && a.bus.kind !== "main")
      add("버스·출력", `${a.label} ${a.bus.name}`, `Bus Setup에서 ${a.label}을(를) 스테레오로`, "파일에는 출력 패치·이름만 들어감");
  for (const b of busesOf(show, "aux")) {
    const where = label.get(b.id) ?? `Aux ${b.number}`;
    add("버스·출력", `${where} ${b.name}`, `센드 ${b.tap === "pre" ? "Pre" : "Post"}로 (Send Point)`, BUS_PURPOSE_LABEL[b.purpose]);
    if (b.purpose === "fx") add("버스·출력", `${where} ${b.name}`, "FX 랙 입력·리턴 채널 설정", b.notes || undefined);
  }
  for (const b of busesOf(show, "matrix")) {
    const where = label.get(b.id) ?? `Matrix ${b.number}`;
    const src = b.sources.map((id) => show.outputs.find((o) => o.id === id)?.name).filter(Boolean).join(", ");
    add("버스·출력", `${where} ${b.name}`, src ? `Matrix 소스: ${src}` : "Matrix 소스 설정", BUS_PURPOSE_LABEL[b.purpose]);
  }
  const mains = busesOf(show, "main");
  if (mains[1]?.width === "stereo" && mains[1].ports.length > 1)
    add("버스·출력", `Stereo B ${mains[1].name}`, "R 출력 패치 (파일에는 L만 들어감)");
  mains.slice(profile.mains).forEach((b) => add("버스·출력", `Main ${b.number} ${b.name}`, `${profile.name}의 Stereo는 ${profile.mains}개 — 다른 버스로 대신 구성`));
  for (const b of show.outputs)
    if (b.ports.some((p) => p.kind === "other"))
      add("버스·출력", `${label.get(b.id) ?? `${b.kind} ${b.number}`} ${b.name}`, "기타 장치로 가는 출력 패치 (파일에 넣지 않음)");

  /* 마무리 */
  add("마무리", "Scene", "현재 상태를 Scene으로 저장 (Store)");
  add("마무리", "백업", "USB로 쇼 파일 저장 (Save)");
  return out;
}
