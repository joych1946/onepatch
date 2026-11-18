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
