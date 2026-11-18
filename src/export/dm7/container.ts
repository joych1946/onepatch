/**
 * Yamaha DM7 쇼 파일(.dmxf / .dm7f) 바깥 컨테이너 — 비공식 분석 결과(docs/research/dm7.md 4.1).
 *
 * [머리말] #YAMAHA MBDFProjectFile … (ProjectInfo 포함)
 * [블록 × N] "#FILE" 머리(빅엔디언) + zlib 압축 내용, 4바이트 정렬
 * [꼬리] 정렬용 0 + "#END" + 0 × 32
 *
 * 바꾸지 않은 블록은 원래의 압축 바이트를 그대로 다시 쓴다(위험을 줄이려고).
 */
import { unzlibSync, zlibSync } from "fflate";

export interface Dm7Block {
  /** 분류 (Current, Setup, PresetList, SceneList, Scn/UserA …) */
  category: string;
  /** 내부 파일 이름 (CurrentBackupFile.bup …) */
  name: string;
  /** 블록 머리 원본 (압축 크기 필드만 다시 쓴다) */
  header: Uint8Array;
  /** 원본 압축 내용 */
  compressed: Uint8Array;
  /** 내용을 바꿨으면 새 내용 (없으면 원본 그대로) */
  replaced?: Uint8Array;
}

export interface Dm7File {
  head: Uint8Array;
  blocks: Dm7Block[];
  /** 기종 표시 (DM7 / DM7C) */
  model: string;
  /** 형식 버전 바이트 (V2 = 02 01, V1.7.5 = 01 4b) */
  formatVersion: string;
}

const MAGIC = "#YAMAHA MBDFProjectFile";
const FILE_TAG = [0x23, 0x46, 0x49, 0x4c, 0x45]; // "#FILE"
const ascii = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const cstr = (b: Uint8Array) => {
  const z = b.indexOf(0);
  return ascii(z < 0 ? b : b.subarray(0, z));
};
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const align4 = (n: number) => (n + 3) & ~3;

export class Dm7FormatError extends Error {}

export function parseDm7File(bytes: Uint8Array): Dm7File {
  if (ascii(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new Dm7FormatError("Yamaha DM7 쇼 파일(.dmxf/.dm7f)이 아닙니다.");
  if (cstr(bytes.subarray(0x24, 0x34)) !== "DM7") throw new Dm7FormatError("DM7 시리즈 파일이 아닙니다.");
  const isTag = (o: number) => FILE_TAG.every((c, k) => bytes[o + k] === c);
  let first = -1;
  for (let o = 0; o + 5 <= bytes.length; o++)
    if (isTag(o)) {
      first = o;
      break;
    }
  if (first < 0) throw new Dm7FormatError("파일 안에 데이터 블록이 없습니다.");

  const blocks: Dm7Block[] = [];
  let o = first;
  while (o + 44 <= bytes.length && isTag(o)) {
    const nameLen = be16(bytes, o + 36);
    const headerLen = align4(44 + nameLen);
    const size = be32(bytes, o + 28);
    const header = bytes.slice(o, o + headerLen);
    const compressed = bytes.slice(o + headerLen, o + headerLen + size);
    if (compressed.length !== size) throw new Dm7FormatError("블록 크기가 파일과 맞지 않습니다.");
    blocks.push({
      category: cstr(header.subarray(12, 24)),
      name: ascii(header.subarray(44, 44 + nameLen)),
      header,
      compressed,
    });
    o = align4(o + headerLen + size);
  }
  // 꼬리 확인: "#END"
  const end = ascii(bytes.subarray(o, o + 4));
  if (end !== "#END") throw new Dm7FormatError("파일 끝 표시(#END)를 찾지 못했습니다. 손상된 파일일 수 있습니다.");
  const head = bytes.slice(0, first);
  const sub = /DM7C/.test(ascii(head)) ? "DM7C" : "DM7";
  return { head, blocks, model: sub, formatVersion: [...head.subarray(0x35, 0x37)].map((x) => x.toString(16).padStart(2, "0")).join(" ") };
}

export function blockData(b: Dm7Block): Uint8Array {
  return b.replaced ?? unzlibSync(b.compressed);
}

export function findBlock(f: Dm7File, name: string): Dm7Block | undefined {
  return f.blocks.find((b) => b.name === name);
}

export function buildDm7File(f: Dm7File): Uint8Array {
  const parts: Uint8Array[] = [f.head];
  let len = f.head.length;
  const push = (p: Uint8Array) => {
    parts.push(p);
    len += p.length;
  };
  for (const b of f.blocks) {
    // DM Editor와 같은 압축 단계(zlib 머리 78 01)
    const data = b.replaced ? zlibSync(b.replaced, { level: 1 }) : b.compressed;
    const header = b.header.slice();
    const v = data.length;
    header[28] = (v >>> 24) & 0xff;
    header[29] = (v >>> 16) & 0xff;
    header[30] = (v >>> 8) & 0xff;
    header[31] = v & 0xff;
    push(header);
    push(data);
    const pad = align4(len) - len;
    if (pad) push(new Uint8Array(pad));
  }
  const tail = new Uint8Array(4 + 32);
  tail.set([0x23, 0x45, 0x4e, 0x44]); // "#END"
  push(tail);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
