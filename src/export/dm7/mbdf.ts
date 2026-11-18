/**
 * MBDF 백업 데이터(내부 파일 .bup) 안의 스키마를 읽어 필드 위치를 계산한다 — 비공식 분석(docs/research/dm7.md 4.2).
 *
 * 섹션: "MMSXLIT" 뒤에 스키마 항목이 이어지고, 항목이 끝난 곳부터 데이터.
 *   컬렉션 48바이트: "COL0" + 이름(24) + u32 × 5 {flags, ?, offset, size, count}   (리틀엔디언)
 *   필드   32바이트: "PR " + type(1) + u16 size + u16 count + 이름(24)          (size 0 = 비트, count개)
 * 중첩: 항목이 지금 컬렉션의 남은 범위에 들어가면 그 자식, 아니면 위로 올라간다.
 * 펌웨어·에디터 버전마다 위치가 달라지므로 위치를 코드에 박지 말고 항상 이걸로 찾는다.
 */

export interface MbdfNode {
  kind: "COL" | "PR";
  name: string;
  /** PR: 0 문자열, 1 부호 정수, 2 부호 없는 정수 */
  type?: number;
  size: number;
  count: number;
  /** 부모 원소 시작 기준 바이트 위치 */
  off: number;
  /** 비트 필드의 시작 비트 (0–7) */
  bit?: number;
  children: MbdfNode[];
}

export interface MbdfSection {
  /** 섹션 최상위 컬렉션 (Mixing, Processing …) */
  root: MbdfNode;
  /** 데이터 시작 위치 (내부 파일 기준) */
  dataStart: number;
}

const latin = new TextDecoder("latin1");
const cname = (b: Uint8Array, o: number, n: number) => {
  const s = b.subarray(o, o + n);
  const z = s.indexOf(0);
  return latin.decode(z < 0 ? s : s.subarray(0, z));
};
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const isAt = (b: Uint8Array, o: number, s: string) => [...s].every((c, k) => b[o + k] === c.charCodeAt(0));

type Frame = { node: MbdfNode; cur: number; bit: number };

function readEntries(b: Uint8Array, i: number): { list: Omit<MbdfNode, "children">[]; end: number } {
  const list: Omit<MbdfNode, "children">[] = [];
  for (;;) {
    if (isAt(b, i, "COL0")) {
      list.push({ kind: "COL", name: cname(b, i + 4, 24), off: u32(b, i + 36), size: u32(b, i + 40), count: u32(b, i + 44) });
      i += 48;
    } else if (isAt(b, i, "PR ")) {
      list.push({ kind: "PR", name: cname(b, i + 8, 24), type: b[i + 3], size: u16(b, i + 4), count: u16(b, i + 6), off: 0 });
      i += 32;
    } else return { list, end: i };
  }
}

function buildTree(list: Omit<MbdfNode, "children">[]): MbdfNode {
  const top: MbdfNode = { kind: "COL", name: "", size: Number.MAX_SAFE_INTEGER, count: 1, off: 0, children: [] };
  const stack: Frame[] = [{ node: top, cur: 0, bit: 0 }];
  for (const raw of list) {
    const e: MbdfNode = { ...raw, children: [] };
    for (;;) {
      const f = stack[stack.length - 1];
      let fits: boolean;
      if (e.kind === "COL") fits = e.off >= f.cur && e.off + e.size * e.count <= f.node.size;
      else if (e.size === 0) fits = f.cur * 8 + f.bit + e.count <= f.node.size * 8;
      else fits = (f.bit ? f.cur + 1 : f.cur) + e.size * e.count <= f.node.size;
      if (fits || stack.length === 1) break;
      stack.pop();
    }
    const f = stack[stack.length - 1];
    if (e.kind === "COL") {
      f.cur = e.off + e.size * e.count;
      f.bit = 0;
      f.node.children.push(e);
      stack.push({ node: e, cur: 0, bit: 0 });
    } else if (e.size === 0) {
      e.off = f.cur;
      e.bit = f.bit;
      const bits = f.bit + e.count;
      f.cur += Math.floor(bits / 8);
      f.bit = bits % 8;
      f.node.children.push(e);
    } else {
      if (f.bit) {
        f.cur += 1;
        f.bit = 0;
      }
      e.off = f.cur;
      f.cur += e.size * e.count;
      f.node.children.push(e);
    }
  }
  return top;
}

export function parseSections(b: Uint8Array): MbdfSection[] {
  const out: MbdfSection[] = [];
  for (let i = 0; i + 7 <= b.length; i++) {
    if (!isAt(b, i, "MMSXLIT\0")) continue;
    let j = i + 8;
    while (j < b.length && !isAt(b, j, "COL0")) j++;
    const { list, end } = readEntries(b, j);
    const top = buildTree(list);
    if (top.children[0]) out.push({ root: top.children[0], dataStart: end });
    i = end;
  }
  return out;
}

export function section(sections: MbdfSection[], name: string): MbdfSection {
  const s = sections.find((x) => x.root.name === name);
  if (!s) throw new Error(`섹션 ${name}을(를) 찾지 못했습니다.`);
  return s;
}

/** 경로의 한 단계: 이름과 (여러 개인 컬렉션의) 번호 */
export type Step = string | [name: string, index: number];

export interface FieldRef {
  node: MbdfNode;
  /** 내부 파일 기준 바이트 위치 */
  pos: number;
}

/** 섹션 안의 경로 → 위치. 예: ["InputChannel", 0], "Label", "Name" */
export function locate(sec: MbdfSection, steps: Step[]): FieldRef {
  let node = sec.root;
  let pos = sec.dataStart;
  for (const st of steps) {
    const [name, index] = typeof st === "string" ? [st, 0] : st;
    const child = node.children.find((c) => c.name === name);
    if (!child) throw new Error(`필드 ${node.name}/${name}을(를) 찾지 못했습니다.`);
    if (index < 0 || index >= child.count) throw new Error(`${name}[${index}] 범위 밖 (개수 ${child.count})`);
    node = child;
    pos += child.off + (child.kind === "COL" ? index * child.size : 0);
  }
  return { node, pos };
}

/* ───────────── 값 읽기·쓰기 ───────────── */

export function readString(b: Uint8Array, f: FieldRef): string {
  const s = b.subarray(f.pos, f.pos + f.node.size);
  const z = s.indexOf(0);
  return new TextDecoder("utf-8").decode(z < 0 ? s : s.subarray(0, z));
}

/** 문자열 필드: UTF-8, 남는 칸은 0. 칸보다 길면 오류 (호출 전에 잘라 둘 것) */
export function writeString(b: Uint8Array, f: FieldRef, value: string) {
  const enc = new TextEncoder().encode(value);
  if (enc.length >= f.node.size) throw new Error(`${f.node.name}: ${f.node.size - 1}바이트를 넘습니다.`);
  b.fill(0, f.pos, f.pos + f.node.size);
  b.set(enc, f.pos);
}

export function readUint(b: Uint8Array, f: FieldRef): number {
  let v = 0;
  for (let k = f.node.size - 1; k >= 0; k--) v = v * 256 + b[f.pos + k];
  return v;
}

export function writeUint(b: Uint8Array, f: FieldRef, value: number) {
  let v = value;
  for (let k = 0; k < f.node.size; k++) {
    b[f.pos + k] = v & 0xff;
    v = Math.floor(v / 256);
  }
}

/** 비트 필드의 i번째 비트 */
export function readBit(b: Uint8Array, f: FieldRef, i = 0): boolean {
  const bit = (f.node.bit ?? 0) + i;
  return (b[f.pos + (bit >> 3)] & (1 << (bit & 7))) !== 0;
}

export function writeBit(b: Uint8Array, f: FieldRef, i: number, on: boolean) {
  const bit = (f.node.bit ?? 0) + i;
  const o = f.pos + (bit >> 3);
  const m = 1 << (bit & 7);
  b[o] = on ? b[o] | m : b[o] & ~m;
}
