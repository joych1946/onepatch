"use client";

/**
 * 패치 현황판 + 채널·버스 목록 (끌어다 놓기 패치).
 *
 * 끌기는 포인터 이벤트로 직접 처리한다 — 마우스는 조금 움직이면, 폰·태블릿은 길게 누르면 끌기 시작.
 * 끄는 중 화면 가장자리에 가면 자동 스크롤, Esc로 취소. 놓을 곳은 data-drop 속성으로 찾는다.
 * - 목록의 채널(여러 개 골라도 됨)·버스 → 포트: 그 포트부터 차례로 패치 (다른 것이 있으면 묻기)
 * - 포트 → 포트: 빈 포트면 옮기기, 사용 중이면 교체 / 서로 바꾸기를 묻기
 * - 포트·패치된 채널 → 목록: 패치 해제
 * 끌기가 불편하면: 목록에서 누르고(여러 개) → 포트를 누르기 / 키보드로 고르고 포트에서 Enter.
 * 모든 변경은 apply 한 번 = 실행 취소 한 번.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Show, StageBox } from "@/model/schema";
import { COLOR_SWATCH, formatPort } from "@/model/labels";
import { micName } from "@/model/derive";
import { busesOf } from "@/model/outputOps";
import { busShort, formatOutPorts } from "@/model/outputColumns";
import { boxUsage, DANTE_BOX, OMNI_BOX, swapPorts, type PortAddr, type PortDir } from "@/model/patch";
import {
  busGroups,
  channelGroups,
  dropConflicts,
  dropGroups,
  replacePort,
  swapUnitInto,
  unitLabel,
  unitsAt,
  unpatchUnits,
  type DropGroup,
} from "@/model/dragPatch";

interface Props {
  show: Show;
  apply: (fn: (s: Show) => Show) => void;
  onMessage: (text: string, details?: string[]) => void;
}

/** 끄는 것: 목록의 채널·버스(묶음) 또는 현황판의 포트 칸 */
type Payload = { kind: "units"; dir: PortDir; groups: DropGroup[]; label: string } | { kind: "port"; addr: PortAddr; label: string };
/** 놓는 곳: 포트 칸 또는 목록(패치 해제) */
type Target = { kind: "port"; addr: PortAddr } | { kind: "list"; dir: PortDir };
type Drag = { payload: Payload; x: number; y: number; over: Target | null };
type Ask = { title: string; lines: string[]; options: { label: string; run: () => void }[] };

const dirOf = (p: Payload) => (p.kind === "units" ? p.dir : p.addr.dir);
const sameAddr = (a: PortAddr | null, b: PortAddr) => !!a && a.dir === b.dir && a.boxId === b.boxId && a.port === b.port;

/** 화면 좌표의 놓을 곳 */
function targetAt(x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  if (!el) return null;
  const dir = el.dataset.dir as PortDir;
  if (el.dataset.drop === "list") return { kind: "list", dir };
  return { kind: "port", addr: { dir, boxId: el.dataset.box!, port: Number(el.dataset.port) } };
}

export default function PatchBoard({ show, apply, onMessage }: Props) {
  const [listDir, setListDir] = useState<PortDir>("in");
  /** 목록에서 고른 것 (채널 id 또는 버스 id) */
  const [sel, setSel] = useState<{ dir: PortDir; ids: string[]; anchor: string | null }>({ dir: "in", ids: [], anchor: null });
  /** 누르기로 바꾸기: 먼저 누른 포트 */
  const [picked, setPicked] = useState<PortAddr | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [ask, setAsk] = useState<Ask | null>(null);
  /** 끌기가 끝난 직후의 click은 무시 (같은 칸에 놓았을 때) */
  const suppressClick = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const selIds = sel.dir === listDir ? sel.ids : [];
  const clearSel = () => setSel({ dir: listDir, ids: [], anchor: null });

  // Esc: 끌기 → 고른 포트 → 목록 선택 순서로 취소 (묻는 창은 창이 직접 닫는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ask) return;
      if (dragRef.current) {
        e.preventDefault();
        cleanupRef.current?.();
        setDrag(null);
      } else if (picked) {
        e.preventDefault();
        setPicked(null);
      } else if (sel.ids.length) {
        e.preventDefault();
        setSel((s) => ({ ...s, ids: [], anchor: null }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, sel.ids.length, ask]);

  // 끄는 중 화면 위·아래 가장자리에서 자동 스크롤
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      const d = dragRef.current;
      if (d) {
        const edge = 64;
        const h = window.innerHeight;
        const v = d.y < edge ? -Math.ceil((edge - d.y) / 4) : d.y > h - edge ? Math.ceil((d.y - (h - edge)) / 4) : 0;
        if (v) {
          window.scrollBy(0, v);
          const over = targetAt(d.x, d.y);
          if (JSON.stringify(over) !== JSON.stringify(d.over)) setDrag({ ...d, over });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  /* ───────── 놓기 ───────── */

  const placeGroups = (dir: PortDir, groups: DropGroup[], addr: PortAddr) => {
    const conflicts = dropConflicts(show, dir, groups, addr.boxId, addr.port);
    const units = groups.flat();
    const run = (mode: "overwrite" | "skip") => {
      const r = dropGroups(show, dir, groups, addr.boxId, addr.port, mode);
      apply((s) => dropGroups(s, dir, groups, addr.boxId, addr.port, mode).show);
      if (r.plan.left) onMessage(`포트가 모자라 ${r.plan.left}개는 넣지 못했습니다. (${boxName(addr.boxId)} ${dir === "in" ? "인풋" : "아웃풋"} 끝)`);
      setSel((s) => ({ ...s, ids: [], anchor: null }));
    };
    if (!conflicts.length) return run("overwrite");
    const lines = conflicts.map((c) => `${boxName(addr.boxId)} ${c.port}: ${unitLabel(show, c.unit)}`);
    if (units.length === 1)
      setAsk({
        title: `${boxName(addr.boxId)} ${addr.port}번에 이미 다른 것이 있습니다`,
        lines,
        options: [
          { label: "교체 (있던 것은 패치 해제)", run: () => run("overwrite") },
          {
            label: "서로 바꾸기",
            run: () => {
              apply((s) => swapUnitInto(s, dir, units[0], addr.boxId, addr.port));
              clearSel();
            },
          },
        ],
      });
    else
      setAsk({
        title: `놓을 자리 중 ${conflicts.length}개 포트를 이미 쓰고 있습니다`,
        lines,
        options: [
          { label: "건너뛰기 (빈 포트에만)", run: () => run("skip") },
          { label: "덮어쓰기 (있던 것은 패치 해제)", run: () => run("overwrite") },
        ],
      });
  };

  const drop = (payload: Payload, target: Target | null) => {
    // 인풋은 인풋 포트에, 아웃풋은 출력 포트에만
    if (!target || (target.kind === "list" ? target.dir : target.addr.dir) !== dirOf(payload)) return;
    if (target.kind === "list") {
      const units = payload.kind === "port" ? unitsAt(show, payload.addr.dir, payload.addr.boxId, payload.addr.port) : payload.groups.flat();
      if (unpatchUnits(show, units) !== show) {
        apply((s) => unpatchUnits(s, units));
        onMessage(`${units.map((u) => unitLabel(show, u)).join(", ")} 패치를 해제했습니다. (⌘Z로 되돌리기)`);
      }
      return;
    }
    if (payload.kind === "port") {
      const from = payload.addr;
      const to = target.addr;
      if (sameAddr(from, to)) return;
      const there = unitsAt(show, to.dir, to.boxId, to.port);
      // 빈 포트면 바로 옮기기, 사용 중이면 묻기
      if (!there.length) return apply((s) => swapPorts(s, from, to));
      const mine = unitsAt(show, from.dir, from.boxId, from.port);
      setAsk({
        title: `${boxName(to.boxId)} ${to.port}번에 이미 다른 것이 있습니다`,
        lines: [
          `옮길 것: ${boxName(from.boxId)} ${from.port} — ${mine.map((u) => unitLabel(show, u)).join(", ")}`,
          `있는 것: ${boxName(to.boxId)} ${to.port} — ${there.map((u) => unitLabel(show, u)).join(", ")}`,
        ],
        options: [
          { label: "교체 (있던 것은 패치 해제)", run: () => apply((s) => replacePort(s, from, to)) },
          { label: "서로 바꾸기", run: () => apply((s) => swapPorts(s, from, to)) },
        ],
      });
      return;
    }
    placeGroups(payload.dir, payload.groups, target.addr);
  };

  /* ───────── 끌기 (포인터) ───────── */

  const startPress = (e: React.PointerEvent, payload: () => Payload) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (ask) return;
    const touch = e.pointerType !== "mouse";
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let timer = 0;
    const begin = (x: number, y: number) => {
      started = true;
      setPicked(null);
      setDrag({ payload: payload(), x, y, over: targetAt(x, y) });
      if (touch) navigator.vibrate?.(15);
    };
    const move = (ev: PointerEvent) => {
      if (!started) {
        const far = Math.hypot(ev.clientX - x0, ev.clientY - y0) > (touch ? 10 : 5);
        if (!far) return;
        if (touch) return cleanup(); // 길게 누르기 전에 움직이면 스크롤
        begin(ev.clientX, ev.clientY);
      }
      const d = dragRef.current;
      if (d) setDrag({ ...d, x: ev.clientX, y: ev.clientY, over: targetAt(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      const d = dragRef.current;
      cleanup();
      if (started && d) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        setDrag(null);
        drop(d.payload, targetAt(ev.clientX, ev.clientY));
      }
    };
    const cancel = () => {
      cleanup();
      setDrag(null);
    };
    // 끌기 시작 뒤에는 터치 스크롤을 막는다
    const noScroll = (ev: TouchEvent) => started && ev.preventDefault();
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("touchmove", noScroll);
      cleanupRef.current = null;
    }
    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    if (touch) timer = window.setTimeout(() => begin(x0, y0), 380);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", noScroll, { passive: false });
  };

  /* ───────── 누르기 ───────── */

  const pressPort = (addr: PortAddr) => {
    if (suppressClick.current) return;
    // 목록에서 고른 것이 있으면 그 포트부터 패치
    if (sel.ids.length && sel.dir === addr.dir) {
      const groups = addr.dir === "in" ? channelGroups(show, sel.ids) : busGroups(show, sel.ids);
      return placeGroups(addr.dir, groups, addr);
    }
    if (!picked) return setPicked(addr);
    if (sameAddr(picked, addr)) return setPicked(null);
    if (picked.dir !== addr.dir) return setPicked(addr);
    apply((s) => swapPorts(s, picked, addr));
    setPicked(null);
  };

  const pressItem = (id: string, e: React.MouseEvent | React.KeyboardEvent, order: string[]) => {
    if (suppressClick.current) return;
    setPicked(null);
    setSel((s) => {
      const cur = s.dir === listDir ? s.ids : [];
      if (e.shiftKey && s.anchor && order.includes(s.anchor)) {
        const [a, b] = [order.indexOf(s.anchor), order.indexOf(id)].sort((x, y) => x - y);
        return { dir: listDir, ids: [...new Set([...cur, ...order.slice(a, b + 1)])], anchor: s.anchor };
      }
      return { dir: listDir, ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], anchor: id };
    });
  };

  /* ───────── 박스 ───────── */

  const omni: StageBox = { id: OMNI_BOX, name: "콘솔 본체 (OMNI)", inputs: 16, outputs: 16, location: "박스 없이 콘솔에 바로" };
  const dante: StageBox = { id: DANTE_BOX, name: "Dante 직결", inputs: 0, outputs: 0, location: "박스 없이 콘솔의 Dante 번호로 — 인풋 표에 “Dante 33”처럼 입력" };
  const danteUsed = boxUsage(show, DANTE_BOX);
  const virtual = [omni, ...(danteUsed.ins.size || danteUsed.outs.size ? [dante] : [])];
  const allBoxes = [...show.stageBoxes, ...virtual];
  function boxName(id: string) {
    return allBoxes.find((b) => b.id === id)?.name ?? "?";
  }

  const busy = !!(drag || picked || sel.ids.length || ask);
  const status = drag
    ? `${drag.payload.label} 끄는 중 — ${dirOf(drag.payload) === "in" ? "인풋" : "아웃풋"} 포트에 놓으면 패치, 목록에 놓으면 해제 (Esc 취소)`
    : picked
      ? `${boxName(picked.boxId)} ${picked.dir === "in" ? "인풋" : "아웃풋"} ${picked.port} 선택됨 — 바꿀 포트를 누르세요 (Esc 취소)`
      : sel.ids.length
        ? `${sel.ids.length}개 고름 — 놓을 ${sel.dir === "in" ? "인풋" : "아웃풋"} 포트를 누르거나 Enter (Esc 취소)`
        : "목록의 채널·버스를 포트에 끌어 놓으면 패치, 포트를 목록으로 끌어내면 해제. 포트끼리 끌거나 차례로 누르면 서로 바뀝니다. 폰·태블릿은 길게 눌러 끌기.";

  return (
    <section data-esc-layer={busy ? "" : undefined} className={drag ? "select-none" : ""}>
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-semibold">패치 현황판</h2>
        <p className="text-xs text-neutral-500" role="status">
          {status}
        </p>
      </div>
      <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-4">
        <UnitList
          show={show}
          dir={listDir}
          setDir={(d) => {
            setListDir(d);
            setSel({ dir: d, ids: [], anchor: null });
          }}
          selIds={selIds}
          drag={drag}
          onPress={pressItem}
          onPointerDown={startPress}
          clearSel={clearSel}
        />
        <div className="mt-4 space-y-4 lg:mt-0">
          {allBoxes.length > 1 && (
            <nav aria-label="박스로 이동" className="sticky top-0 z-[5] -mx-1 flex flex-wrap gap-1 bg-white/90 px-1 py-1 text-xs backdrop-blur dark:bg-neutral-950/90">
              {allBoxes.map((b) => (
                <a key={b.id} href={`#patch-box-${b.id}`} className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  {b.name}
                </a>
              ))}
            </nav>
          )}
          {allBoxes.map((box) => (
            <BoxCard
              key={box.id}
              show={show}
              box={box}
              virtual={box.id === OMNI_BOX || box.id === DANTE_BOX}
              picked={picked}
              drag={drag}
              selDir={sel.ids.length ? sel.dir : null}
              onPress={pressPort}
              onPointerDown={startPress}
            />
          ))}
        </div>
      </div>

      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow-lg"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
          aria-hidden
        >
          {drag.payload.label}
        </div>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </section>
  );
}

/* ───────────── 목록 ───────────── */

function UnitList({
  show,
  dir,
  setDir,
  selIds,
  drag,
  onPress,
  onPointerDown,
  clearSel,
}: {
  show: Show;
  dir: PortDir;
  setDir: (d: PortDir) => void;
  selIds: string[];
  drag: Drag | null;
  onPress: (id: string, e: React.MouseEvent | React.KeyboardEvent, order: string[]) => void;
  onPointerDown: (e: React.PointerEvent, payload: () => Payload) => void;
  clearSel: () => void;
}) {
  const dropHere = drag && dirOf(drag.payload) === dir && (drag.payload.kind === "port" || drag.payload.groups.flat().some((u) => (u.dir === "in" ? show.inputs.find((c) => c.id === u.channelId)?.port : show.outputs.find((b) => b.id === u.busId)?.ports[u.side])));
  const over = drag?.over?.kind === "list" && drag.over.dir === dir;

  type Row = { id: string; patched: boolean; node: ReactNode; label: string; groups: (ids: string[]) => DropGroup[]; sides?: { side: number; label: string; patched: boolean }[] };
  const rows: Row[] =
    dir === "in"
      ? show.inputs.map((c) => {
          const linked = c.stereoLinkNext || show.inputs.find((p) => p.number === c.number - 1)?.stereoLinkNext;
          return {
            id: c.id,
            patched: !!c.port,
            label: `Ch ${c.number}${c.source ? ` ${c.source}` : ""}`,
            groups: (ids) => channelGroups(show, ids),
            node: (
              <>
                <span className="w-7 shrink-0 text-right font-medium tabular-nums">{c.number}</span>
                {c.color !== "none" && <span className="h-3 w-1 shrink-0 rounded-sm" style={{ background: COLOR_SWATCH[c.color] }} />}
                <span className="min-w-0 flex-1 truncate">
                  {c.source || <span className="text-neutral-400">(소스 없음)</span>}
                  {linked && <span className="ml-1 text-[10px] text-neutral-500">↔</span>}
                  <span className="block truncate text-[10px] text-neutral-500">{micName(show, c) || "—"}</span>
                </span>
                {c.port && <span className="shrink-0 text-[10px] text-neutral-500 tabular-nums">{formatPort(c.port, show.stageBoxes)}</span>}
              </>
            ),
          };
        })
      : (["aux", "matrix", "main"] as const).flatMap((k) =>
          busesOf(show, k).map((b) => ({
            id: b.id,
            patched: b.ports.length > 0,
            label: `${busShort(b)} ${b.name}`.trim(),
            groups: (ids: string[]) => busGroups(show, ids),
            sides: b.width === "stereo" ? [0, 1].map((side) => ({ side, label: side ? "R" : "L", patched: !!b.ports[side] })) : undefined,
            node: (
              <>
                <span className="w-14 shrink-0 font-medium">{busShort(b)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {b.name || <span className="text-neutral-400">(이름 없음)</span>}
                  <span className="block truncate text-[10px] text-neutral-500">{b.width === "stereo" ? "Stereo" : "Mono"}</span>
                </span>
                {b.ports.length > 0 && <span className="shrink-0 text-[10px] text-neutral-500">{formatOutPorts(show, b.ports)}</span>}
              </>
            ),
          })),
        );
  const order = rows.map((r) => r.id);
  const payloadFor = (r: Row): Payload => {
    const ids = selIds.includes(r.id) ? selIds : [r.id];
    const groups = r.groups(ids);
    const n = groups.flat().length;
    return { kind: "units", dir, groups, label: ids.length > 1 ? `${ids.length}개 (${n}포트)` : `${r.label}${n > 1 ? ` (${n}포트)` : ""}` };
  };

  const item = (r: Row) => {
    const on = selIds.includes(r.id);
    return (
      <li key={r.id} className="flex items-stretch gap-1">
        <button
          onPointerDown={(e) => onPointerDown(e, () => payloadFor(r))}
          onClick={(e) => onPress(r.id, e, order)}
          onContextMenu={(e) => e.preventDefault()}
          aria-pressed={on}
          aria-label={`${r.label}${r.patched ? " 패치됨" : ""}`}
          className={`flex min-h-10 min-w-0 flex-1 touch-manipulation items-center gap-1.5 rounded border px-1.5 py-1 text-left text-xs select-none [-webkit-touch-callout:none] ${
            on ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          } cursor-grab`}
        >
          {r.node}
        </button>
        {r.sides?.map((sd) => (
          <button
            key={sd.side}
            title={`${r.label} ${sd.label}만 끌기`}
            aria-label={`${r.label} ${sd.label}만`}
            onPointerDown={(e) => onPointerDown(e, () => ({ kind: "units", dir: "out", groups: busGroups(show, [r.id], sd.side), label: `${r.label} ${sd.label}` }))}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-7 shrink-0 cursor-grab touch-manipulation rounded border text-[10px] select-none ${sd.patched ? "border-neutral-300 dark:border-neutral-700" : "border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700"}`}
          >
            {sd.label}
          </button>
        ))}
      </li>
    );
  };

  const unpatched = rows.filter((r) => !r.patched);
  const patched = rows.filter((r) => r.patched);
  const noun = dir === "in" ? "채널" : "버스";
  return (
    <aside
      data-drop="list"
      data-dir={dir}
      aria-label={`${noun} 목록`}
      className={`rounded border p-2 lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto ${
        over ? "border-2 border-blue-600 bg-blue-50 dark:bg-blue-950/40" : dropHere ? "border-dashed border-blue-400" : "border-neutral-200 dark:border-neutral-800"
      } max-h-80 overflow-y-auto`}
    >
      <div className="mb-2 flex items-center gap-1 text-xs" role="tablist">
        {(["in", "out"] as const).map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={dir === d}
            onClick={() => setDir(d)}
            className={`rounded px-2 py-1 ${dir === d ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            {d === "in" ? "인풋 채널" : "아웃풋 버스"}
          </button>
        ))}
        {selIds.length > 0 && (
          <button className="ml-auto rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={clearSel}>
            선택 해제 ({selIds.length})
          </button>
        )}
      </div>
      {dropHere && <p className="mb-2 rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-800 dark:bg-blue-950 dark:text-blue-200">여기에 놓으면 패치 해제</p>}
      <h3 className="mb-1 text-[11px] font-medium text-neutral-500">
        패치 안 된 {noun} ({unpatched.length})
      </h3>
      {unpatched.length ? <ul className="mb-3 space-y-1">{unpatched.map(item)}</ul> : <p className="mb-3 text-[11px] text-neutral-400">없음</p>}
      <h3 className="mb-1 text-[11px] font-medium text-neutral-500">
        패치된 {noun} ({patched.length})
      </h3>
      {patched.length ? <ul className="space-y-1">{patched.map(item)}</ul> : <p className="text-[11px] text-neutral-400">없음</p>}
      <p className="mt-2 text-[10px] text-neutral-500">눌러서 여러 개 고르기(Shift: 범위) → 포트를 누르거나 끌어 놓기. 스테레오 링크는 짝과 함께 움직입니다.</p>
    </aside>
  );
}

/* ───────────── 박스 카드 ───────────── */

function BoxCard({
  show,
  box,
  virtual,
  picked,
  drag,
  selDir,
  onPress,
  onPointerDown,
}: {
  show: Show;
  box: StageBox;
  /** 박스 없는 포트 묶음: 포트 수 제한이 없고, 쓰는 포트 + 기본 칸 수만큼 보여 준다 */
  virtual?: boolean;
  picked: PortAddr | null;
  drag: Drag | null;
  /** 목록에서 고른 것의 방향 (그 방향 포트를 강조) */
  selDir: PortDir | null;
  onPress: (p: PortAddr) => void;
  onPointerDown: (e: React.PointerEvent, payload: () => Payload) => void;
}) {
  const { ins, outs } = boxUsage(show, box.id);
  const maxIn = Math.max(box.inputs, ...ins.keys());
  const maxOut = Math.max(box.outputs, ...outs.keys());
  const want = drag ? dirOf(drag.payload) : selDir;

  const cell = (dir: PortDir, port: number) => {
    const addr: PortAddr = { dir, boxId: box.id, port };
    const over = !virtual && port > (dir === "in" ? box.inputs : box.outputs);
    let label = "";
    let sub = "";
    let color: string | undefined;
    let count = 0;
    if (dir === "in") {
      const users = ins.get(port) ?? [];
      count = users.length;
      const ch = users[0] && show.inputs[users[0].channelIndex];
      if (ch) {
        label = `${ch.number}${count > 1 ? `+${users.slice(1).map((u) => show.inputs[u.channelIndex].number).join("+")}` : ""}`;
        sub = ch.shortName || ch.source;
        color = ch.color === "none" ? undefined : COLOR_SWATCH[ch.color];
      }
    } else {
      const users = outs.get(port) ?? [];
      count = users.length;
      const u = users[0];
      if (u) {
        const k = u.bus.kind === "aux" ? "Aux" : u.bus.kind === "matrix" ? "Mtx" : "";
        label = `${k ? `${k} ${u.bus.number}` : u.bus.name}${u.bus.width === "stereo" ? (u.side === 0 ? " L" : u.side === 1 ? " R" : "") : ""}`;
        sub = k ? u.bus.name : "";
        if (count > 1) label += ` +${count - 1}`;
      }
    }
    const isPicked = sameAddr(picked, addr);
    const isOver = drag?.over?.kind === "port" && sameAddr(drag.over.addr, addr);
    const can = want === null || want === dir;
    const bad = count > 1 || (over && count > 0);
    return (
      <button
        key={`${dir}:${port}`}
        data-drop="port"
        data-dir={dir}
        data-box={box.id}
        data-port={port}
        onPointerDown={count ? (e) => onPointerDown(e, () => ({ kind: "port", addr, label: `${box.name} ${port} ${label}` })) : undefined}
        onClick={() => onPress(addr)}
        onKeyDown={(e) => moveFocus(e)}
        onContextMenu={(e) => count && e.preventDefault()}
        aria-label={`${box.name} ${dir === "in" ? "인풋" : "아웃풋"} ${port}${label ? ` ${label} ${sub}` : " 비어 있음"}`}
        aria-pressed={isPicked}
        title={bad ? (count > 1 ? "같은 포트를 여럿이 사용" : "박스 포트 수 초과") : undefined}
        className={`relative flex h-14 min-w-0 touch-manipulation flex-col items-start justify-start overflow-hidden rounded border px-1.5 py-1 text-left text-xs select-none [-webkit-touch-callout:none] ${
          count ? "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" : "border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700"
        } ${bad ? "border-red-500 bg-red-50 dark:bg-red-950/60" : ""} ${over && !count ? "hidden" : ""} ${isPicked ? "ring-2 ring-blue-600" : ""} ${
          isOver ? "bg-blue-100 ring-2 ring-blue-600 dark:bg-blue-900" : want && can ? "ring-1 ring-blue-300 dark:ring-blue-700" : ""
        } ${want && !can ? "opacity-30" : ""} ${count ? "cursor-grab" : ""}`}
      >
        {color && <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />}
        <span className="text-[10px] text-neutral-400 tabular-nums">{port}</span>
        <span className="w-full truncate font-medium">{label}</span>
        {sub && <span className="w-full truncate text-[10px] text-neutral-500">{sub}</span>}
      </button>
    );
  };

  const grid = "grid grid-cols-4 gap-1 sm:grid-cols-8 xl:grid-cols-16";
  return (
    <div id={`patch-box-${box.id}`} className="scroll-mt-10 rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">{box.name}</h3>
        <span className="text-xs text-neutral-500">{box.location}</span>
        <span className="ml-auto text-xs text-neutral-500">
          {virtual ? `사용 인풋 ${ins.size} · 아웃풋 ${outs.size}` : `인풋 ${ins.size}/${box.inputs} · 아웃풋 ${outs.size}/${box.outputs}`}
        </span>
      </div>
      {maxIn > 0 && (
        <>
          <p className="mb-1 text-xs font-medium text-neutral-500">인풋</p>
          <div className={grid}>{Array.from({ length: maxIn }, (_, i) => cell("in", i + 1))}</div>
        </>
      )}
      {maxOut > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs font-medium text-neutral-500">아웃풋</p>
          <div className={grid}>{Array.from({ length: maxOut }, (_, i) => cell("out", i + 1))}</div>
        </>
      )}
    </div>
  );
}

/** 포트 칸에서 화살표로 이웃 칸으로 (위·아래는 한 줄의 칸 수만큼) */
function moveFocus(e: React.KeyboardEvent<HTMLButtonElement>) {
  const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[e.key];
  if (!d) return;
  const grid = e.currentTarget.parentElement;
  if (!grid) return;
  const cells = [...grid.querySelectorAll<HTMLButtonElement>("button[data-drop]")].filter((b) => b.offsetParent);
  const i = cells.indexOf(e.currentTarget);
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length || 1;
  const step = Math.abs(d) === 1 ? d : (d / 2) * cols;
  const next = cells[i + step];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/* ───────────── 묻기 ───────────── */

function AskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ask.title}
        className="absolute inset-x-0 bottom-0 space-y-3 rounded-t-2xl bg-white p-5 text-sm shadow-2xl sm:inset-x-auto sm:top-24 sm:bottom-auto sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2 sm:rounded-2xl dark:bg-neutral-900"
      >
        <h2 className="font-semibold">{ask.title}</h2>
        <ul className="max-h-40 overflow-y-auto text-xs text-neutral-600 dark:text-neutral-300">
          {ask.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          {ask.options.map((o, i) => (
            <button
              key={o.label}
              autoFocus={i === 0}
              className={`rounded border px-3 py-1.5 ${i === 0 ? "border-blue-600 bg-blue-600 font-medium text-white" : "border-neutral-300 dark:border-neutral-700"}`}
              onClick={() => {
                onClose();
                o.run();
              }}
            >
              {o.label}
            </button>
          ))}
          <button className="rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700" onClick={onClose}>
            취소 <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

