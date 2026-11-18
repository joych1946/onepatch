/** 이름 비교용 정규화: 대소문자·공백·기호 무시 ("Shure SM-58" ≈ "shuresm58") */
export const norm = (s: string) => s.toLowerCase().replace(/[\s._\-/()#:+]/g, "");

/** 제조사(첫 단어)를 뺀 모델명 정규화: "Shure SM58" → "sm58" */
export const bareModel = (model: string) => norm(model.trim().replace(/^\S+\s+/, ""));
