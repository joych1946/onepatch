/** 인풋 채널 편집 연산 — 전부 순수 함수 (Show → Show). 실행 취소는 호출부의 히스토리가 담당. */
import { newId } from "./factory";
import type { InputChannel, Show } from "./schema";

export function newChannel(number: number): InputChannel {
  return {
    id: newId(),
    number,
    source: "",
    shortName: "",
    performer: "",
    mic: null,
    stand: null,
    phantom: null,
    port: null,
    stereoLinkNext: false,
    color: "none",
    dcaIds: [],
    muteGroupIds: [],
    notes: "",
  };
}

export function nextNumber(inputs: InputChannel[]): number {
  return inputs.reduce((m, c) => Math.max(m, c.number), 0) + 1;
}

export function withInputs(show: Show, inputs: InputChannel[]): Show {
  return { ...show, inputs };
}

export function updateChannel(
  show: Show,
  index: number,
  patch: Partial<InputChannel>,
): Show {
  const inputs = show.inputs.slice();
  inputs[index] = { ...inputs[index], ...patch };
  return withInputs(show, inputs);
}

/** 행 순서대로 1, 2, 3… */
export function renumberSequential(inputs: InputChannel[]): InputChannel[] {
  return inputs.map((c, i) => (c.number === i + 1 ? c : { ...c, number: i + 1 }));
}

const finish = (show: Show, inputs: InputChannel[], renumber: boolean) =>
  withInputs(show, renumber ? renumberSequential(inputs) : inputs);

/** 마지막에 빈 채널 추가 */
export function appendChannel(show: Show): Show {
  return withInputs(show, [...show.inputs, newChannel(nextNumber(show.inputs))]);
}

/** index 행 아래에 빈 채널 삽입 (index = -1이면 맨 위) */
export function insertAfter(show: Show, index: number, renumber: boolean): Show {
  const inputs = show.inputs.slice();
  const wanted = (inputs[index]?.number ?? 0) + 1;
  const taken = inputs.some((c) => c.number === wanted);
  inputs.splice(index + 1, 0, newChannel(taken ? nextNumber(inputs) : wanted));
  return finish(show, inputs, renumber);
}

/** [from, to] 행을 복제해 바로 아래에 넣는다 */
export function duplicateRange(show: Show, from: number, to: number, renumber: boolean): Show {
  const inputs = show.inputs.slice();
  let n = nextNumber(inputs);
  const copies = inputs
    .slice(from, to + 1)
    .map((c) => ({ ...structuredClone(c), id: newId(), number: n++ }));
  inputs.splice(to + 1, 0, ...copies);
  return finish(show, inputs, renumber);
}

export function deleteRange(show: Show, from: number, to: number, renumber: boolean): Show {
  const inputs = show.inputs.slice();
  inputs.splice(from, to - from + 1);
  return finish(show, inputs, renumber);
}

/**
 * [from, to] 행 묶음을 옮긴다. insertBefore는 옮기기 전 배열 기준의 삽입 위치(0…length).
 * 반환: 새 Show와 옮겨진 묶음의 새 시작 인덱스
 */
export function moveRange(
  show: Show,
  from: number,
  to: number,
  insertBefore: number,
  renumber: boolean,
): { show: Show; start: number } {
  if (insertBefore >= from && insertBefore <= to + 1) return { show, start: from };
  const inputs = show.inputs.slice();
  const block = inputs.splice(from, to - from + 1);
  const start = insertBefore > to ? insertBefore - block.length : insertBefore;
  inputs.splice(start, 0, ...block);
  return { show: finish(show, inputs, renumber), start };
}
