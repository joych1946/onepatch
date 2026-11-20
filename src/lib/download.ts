export function downloadText(fileName: string, text: string, mime = "application/json") {
  downloadBlob(fileName, new Blob([text], { type: mime }));
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 입력 중일 때는 단축키를 무시하기 위한 검사 */
export function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
  );
}

/**
 * Esc로 "이전 화면"에 가도 되는가. 열려 있는 대화상자·선택 창(aria-modal),
 * 고르는 중인 상태(data-esc-layer)나 편집 칸이 있으면 그것부터 닫아야 하므로 false.
 * (자식의 window 리스너가 부모보다 늦게 등록되면 preventDefault가 늦으므로 화면 상태로 판단한다)
 */
export function escGoesBack(e: KeyboardEvent): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  return !document.querySelector('[aria-modal="true"], [data-esc-layer]');
}
