/**
 * 스테이지박스 기종 목록: 고르면 이름과 인풋·아웃풋 수가 채워진다(그 뒤에 자유롭게 고칠 수 있음).
 * 포트 수는 제조사 공식 사양으로 확인한 값만 넣는다. 아웃풋은 아날로그 출력 수
 * (Rio3224 계열의 AES/EBU 디지털 출력 8ch는 세지 않는다).
 *
 * 출처 (Yamaha 공식 사양 페이지)
 * - Rio3224-D2 / Rio1608-D2: https://usa.yamaha.com/products/proaudio/interfaces/r_series_adda_2/specs.html
 * - Rio3224-D3: https://usa.yamaha.com/products/proaudio/interfaces/r_series_adda_3/specs.html
 *   (Rio3224-D3 Reference Manual)
 * - Rio1608-D3: https://europe.yamaha.com/en/business/audio/products/interfaces/r-series-adda-3/specs.html
 */
import { norm } from "./text";

export interface StageBoxModel {
  name: string;
  maker: string;
  inputs: number;
  outputs: number;
  note?: string;
}

export const STAGEBOX_MODELS: readonly StageBoxModel[] = [
  { name: "Rio3224-D3", maker: "Yamaha", inputs: 32, outputs: 16, note: "AES/EBU 출력 8ch 별도" },
  { name: "Rio1608-D3", maker: "Yamaha", inputs: 16, outputs: 8 },
  { name: "Rio3224-D2", maker: "Yamaha", inputs: 32, outputs: 16, note: "AES/EBU 출력 8ch 별도 · 단종" },
  { name: "Rio1608-D2", maker: "Yamaha", inputs: 16, outputs: 8, note: "단종" },
];

/** 이름이 기종 이름과 같으면 그 기종 ("rio3224 d3"처럼 띄어 쓰거나 소문자여도) */
export function findStageBoxModel(name: string): StageBoxModel | undefined {
  const n = norm(name);
  return n ? STAGEBOX_MODELS.find((m) => norm(m.name) === n) : undefined;
}
