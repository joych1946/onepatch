/**
 * "누르기만 해서 입력" 흐름의 데이터 변경 — 순수 함수.
 * 소스를 고르면 소스명·짧은 이름·컬러(·스테레오 링크), 마이크를 고르면 마이크가 들어간다.
 * 48V와 스탠드는 채널 값이 비어 있으면(null) 마이크 기본값을 따르므로 따로 쓰지 않는다.
 *
 * "내가 고친 값은 덮어쓰지 않는다": 짧은 이름·컬러가 비어 있거나
 * 이전 소스가 자동으로 넣었을 값과 같을 때만 바꾼다.
 */
import { appendChannel, insertAfter, updateChannel } from "./inputOps";
import {
  channelsOf,
  ensureShowMic,
  findSource,
  type Library,
  type LibraryMic,
  type SourceDef,
} from "./library";
import type { InputChannel, Show } from "./schema";

export type SourceChoice = { kind: "library"; src: SourceDef } | { kind: "text"; name: string };
export type MicChoice = { kind: "library"; mic: LibraryMic } | { kind: "text"; name: string };

const isBlank = (c: InputChannel) => c.source.trim() === "" && c.mic === null;

/** 이 채널 값이 자동 채움으로 들어간 것으로 볼 수 있는가 */
function autoValues(lib: Library, ch: InputChannel) {
  const f = findSource(lib, ch.source);
  return {
    shortName: f ? channelsOf(f.src)[f.side].shortName : ch.source,
    color: f?.src.color,
  };
}

/**
 * index 행에 소스를 넣는다 (index가 행 수와 같으면 새 채널).
 * 스테레오 소스는 다음 행까지 두 채널을 채우고 링크한다.
 * 다음 행에 다른 내용이 있으면 덮어쓰지 않고 그 사이에 행을 끼워 넣는다.
 * 반환: 새 Show와 채워진 행 인덱스들
 */
export function applySourcePick(
  show: Show,
  lib: Library,
  index: number,
  choice: SourceChoice,
  renumber: boolean,
): { show: Show; rows: number[] } {
  let s = show;
  if (index >= s.inputs.length) {
    s = appendChannel(s);
    index = s.inputs.length - 1;
  }
  const names =
    choice.kind === "library"
      ? channelsOf(choice.src)
      : [{ source: choice.name.trim(), shortName: choice.name.trim() }];
  const color = choice.kind === "library" ? choice.src.color : null;

  const rows = [index];
  const before = findSource(lib, s.inputs[index].source);
  if (names.length === 2) {
    const j = index + 1;
    const next = s.inputs[j];
    const nextF = next ? findSource(lib, next.source) : null;
    const reusable =
      next &&
      (isBlank(next) ||
        // 같은 스테레오 소스의 R이거나, 이 행에 있던 스테레오 소스의 R
        (nextF?.side === 1 &&
          (nextF.src.id === (choice.kind === "library" ? choice.src.id : "") ||
            (before?.side === 0 && before.src.stereo && nextF.src.id === before.src.id))));
    if (!next) s = appendChannel(s);
    else if (!reusable) s = insertAfter(s, index, renumber);
    rows.push(j);
  }

  rows.forEach((r, k) => {
    const ch = s.inputs[r];
    const auto = autoValues(lib, ch);
    const patch: Partial<InputChannel> = { source: names[k].source };
    if (ch.shortName === "" || ch.shortName === auto.shortName) patch.shortName = names[k].shortName;
    if (color && (ch.color === "none" || ch.color === auto.color)) patch.color = color;
    if (rows.length === 2 && k === 0) patch.stereoLinkNext = true;
    // 스테레오 L이던 행을 모노 소스로 바꾸면 링크도 푼다
    if (rows.length === 1 && ch.stereoLinkNext && before?.src.stereo && before.side === 0)
      patch.stereoLinkNext = false;
    s = updateChannel(s, r, patch);
  });
  return { show: s, rows };
}

/** rows 행들에 마이크를 넣는다 (스테레오면 두 채널 모두 같은 모델) */
export function applyMicPick(show: Show, rows: number[], choice: MicChoice): Show {
  let s = show;
  let mic: InputChannel["mic"];
  if (choice.kind === "library") {
    const r = ensureShowMic(s, choice.mic);
    s = r.show;
    mic = { kind: "library", microphoneId: r.id };
  } else {
    mic = { kind: "custom", name: choice.name.trim() };
  }
  for (const r of rows) if (s.inputs[r]) s = updateChannel(s, r, { mic });
  return s;
}

/** 이미 소스가 있는 행의 "소스 유지" — 스테레오 L이면 R까지 묶어서 돌려준다 */
export function rowsForExisting(show: Show, lib: Library, index: number): { rows: number[]; src: SourceDef | null } {
  const ch = show.inputs[index];
  if (!ch) return { rows: [index], src: null };
  const f = findSource(lib, ch.source);
  if (f?.src.stereo && f.side === 0 && ch.stereoLinkNext && show.inputs[index + 1])
    return { rows: [index, index + 1], src: f.src };
  return { rows: [index], src: f?.src ?? null };
}
