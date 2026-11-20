/** 10번: 48V 체크리스트, 콘솔 할 일 */
import { describe, expect, it } from "vitest";
import { createSampleShow } from "@/sample/fivePieceBand";
import { phantomChecklist } from "@/model/reports";
import { consoleTasks } from "@/export/dm7/tasks";
import { resolvePhantom } from "@/model/derive";
import { updateChannel } from "@/model/inputOps";

describe("48V 체크리스트 (10번)", () => {
  it("팬텀이 필요한 채널만, 포트 순서로 (박스 표 순서 → OMNI → Dante 직결)", () => {
    let s = createSampleShow();
    // Ch 1을 OMNI 2로 옮겨도 박스 포트들보다 뒤에 온다
    s = updateChannel(s, 0, { port: { kind: "local", port: 2 } });
    const { on } = phantomChecklist(s);
    const need = s.inputs.filter((c) => resolvePhantom(s, c));
    expect(on.length).toBe(need.length);
    expect(on.at(-1)!.cells.ch).toBe(1);
    expect(on.at(-1)!.cells.port).toBe("OMNI 2");
    expect(on.every((r) => r.cells.check === "☐")).toBe(true);
    const boxRows = on.filter((r) => String(r.cells.port).startsWith(s.stageBoxes[0].name));
    const nums = boxRows.map((r) => parseInt(String(r.cells.port).split(" ").pop()!, 10));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it("리본 마이크 채널은 48V 걸면 안 되는 묶음으로 따로", () => {
    let s = createSampleShow();
    s = { ...s, microphones: [...s.microphones, { id: "mic-r121", model: "Royer R-121", type: "ribbon", needsPhantom: false, defaultStand: "숏T" }] };
    s = updateChannel(s, 5, { mic: { kind: "library", microphoneId: "mic-r121" }, phantom: true }); // 실수로 48V 켬
    const { on, never } = phantomChecklist(s);
    expect(never.map((r) => r.cells.ch)).toEqual([s.inputs[5].number]);
    expect(on.some((r) => r.cells.ch === s.inputs[5].number)).toBe(false);
  });

  it("콘솔에서 직접 할 일: 48V 켜기 n채널 — 48V 체크리스트 참고", () => {
    const s = createSampleShow();
    const n = phantomChecklist(s).on.length;
    expect(n).toBeGreaterThan(0);
    expect(consoleTasks(s).map((t) => t.task)).toContain(`48V 켜기 ${n}채널 — 48V 체크리스트 참고`);
  });
});
