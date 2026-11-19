/** 이름 비교용 정규화: 대소문자·공백·기호 무시 ("Shure SM-58" ≈ "shuresm58") */
export const norm = (s: string) => s.toLowerCase().replace(/[\s._\-/()#:+]/g, "");

/** 제조사(첫 단어)를 뺀 모델명 정규화: "Shure SM58" → "sm58" */
export const bareModel = (model: string) => norm(model.trim().replace(/^\S+\s+/, ""));

/**
 * 글자 수 제한에 맞춘 짧은 이름 제안 (콘솔 표시용).
 * 1) 띄어쓰기 없애고 붙이기 → 2) 가장 긴 단어부터 첫 글자가 아닌 소문자 모음 빼기 → 3) 뒤를 자르기
 * 예: "Front Fill" → "FrntFill", "Bass Wedge" → "BassWedg", "25현 가야금 소리" → "25현가야금소리"
 */
export function suggestShortName(raw: string, max: number): string {
  const s = raw.trim().replace(/\s+/g, " ");
  const len = (w: string[][]) => w.reduce((n, x) => n + x.length, 0);
  if ([...s].length <= max) return s;
  const words = s.split(/[\s_]+/).filter(Boolean).map((w) => [...w]);
  while (len(words) > max) {
    // 모음을 뺄 수 있는 단어 중 가장 긴 것 (같으면 뒤쪽)
    let best = -1;
    words.forEach((w, i) => {
      if (w.slice(1).some((c) => /[aeiou]/.test(c)) && (best < 0 || w.length >= words[best].length)) best = i;
    });
    if (best < 0) break;
    const w = words[best];
    for (let i = w.length - 1; i >= 1; i--)
      if (/[aeiou]/.test(w[i])) {
        w.splice(i, 1);
        break;
      }
  }
  return words.flat().slice(0, max).join("");
}
