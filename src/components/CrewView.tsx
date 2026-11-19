"use client";

/**
 * 크루 화면 (읽기 전용, 로그인 없음, 모바일 우선): /s?id=…
 * - 서버(/api/share)에서 받은 값을 그대로 그린다. 가볍게 유지하려고 모델·검증 코드는 가져오지 않는다.
 * - 역할 필터(무대·모니터·FOH), 바뀐 것만 보기, ▲ 변경 표시(바뀐 칸은 이전 → 이후)
 * - 마지막으로 받은 내용을 이 폰에 저장해 두고, 통신이 안 되면 그것을 보여 준다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SharePayload, ShareRow } from "@/model/share";
import { ROLE_INPUT_FIELDS, ROLE_OUTPUT_FIELDS, SHARE_ROLES, type ShareRole } from "@/model/shareRoles";
import { COLOR_SWATCH } from "@/model/labels";

const ROLE_KEY = "onepatch.crewRole";
const cacheKey = (id: string) => `onepatch.share.${id}`;
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Loaded = { payload: SharePayload; fetchedAt: string; offline: boolean };

export default function CrewView() {
  const id = useSearchParams().get("id") ?? "";
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<ShareRole>("foh");
  const [onlyChanged, setOnlyChanged] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw Object.assign(new Error(body.error ?? `서버 응답 ${res.status}`), { status: res.status });
      const loaded = { payload: body as SharePayload, fetchedAt: new Date().toISOString(), offline: false };
      setData(loaded);
      setError(null);
      store.set(cacheKey(id), JSON.stringify(loaded));
    } catch (e) {
      const status = (e as { status?: number }).status;
      // 통신 문제면 마지막 받은 내용을 보여 준다. 공유가 중지(404)된 경우는 그대로 알린다.
      const cached = status === 404 ? null : store.get(cacheKey(id));
      if (cached) {
        const c = JSON.parse(cached) as Loaded;
        setData({ ...c, offline: true });
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const r = store.get(ROLE_KEY) as ShareRole | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (r && SHARE_ROLES.some((x) => x.key === r)) setRole(r);
    // 먼저 저장해 둔 것을 바로 보여 주고(느린 통신 대비), 새로 받아 바꾼다
    const cached = id ? store.get(cacheKey(id)) : null;
    if (cached) setData({ ...(JSON.parse(cached) as Loaded), offline: false });
    void load();
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [id, load]);

  useEffect(() => {
    if (data) document.title = `${data.payload.title} — 크루`;
  }, [data]);

  const pickRole = (r: ShareRole) => {
    setRole(r);
    store.set(ROLE_KEY, r);
  };

  if (!id) return <main className="p-5">공유 링크가 올바르지 않습니다.</main>;
  if (!data)
    return (
      <main className="p-5">
        {error ? (
          <>
            <p className="text-red-600">{error}</p>
            <button className="mt-3 rounded border px-3 py-2" onClick={() => void load()}>
              다시 시도
            </button>
          </>
        ) : (
          <p className="text-neutral-500">불러오는 중…</p>
        )}
      </main>
    );

  const p = data.payload;
  return (
    <main className="mx-auto w-full max-w-[720px] pb-16 text-[15px]">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 px-4 pt-3 pb-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-bold">{p.title}</h1>
            <p className="truncate text-xs text-neutral-500">
              {[p.date, p.venue, p.version && `버전 ${p.version}`].filter(Boolean).join(" · ")} · 공유 {when(p.publishedAt)}
            </p>
          </div>
          <button onClick={() => void load()} className="shrink-0 rounded border border-neutral-300 px-2.5 py-1 text-sm dark:border-neutral-700" aria-label="새로고침">
            {loading ? "…" : "새로고침"}
          </button>
        </div>
        {data.offline && <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">통신이 안 되어 {when(data.fetchedAt)}에 받은 내용을 보여 줍니다.</p>}
        {p.base && p.changeCount > 0 && (
          <p className="mt-1 text-xs">
            <b className="text-amber-700 dark:text-amber-300">▲ 바뀐 것 {p.changeCount}개</b> <span className="text-neutral-500">({p.base.label} 이후)</span>
          </p>
        )}
        <div className="mt-2 flex items-center gap-1" role="tablist" aria-label="역할">
          {SHARE_ROLES.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={role === r.key}
              onClick={() => pickRole(r.key)}
              className={`flex-1 rounded px-2 py-1.5 text-sm ${role === r.key ? "bg-blue-600 font-semibold text-white" : "bg-neutral-100 dark:bg-neutral-800"}`}
            >
              {r.label}
              <span className="block text-[10px] font-normal opacity-80">{r.note}</span>
            </button>
          ))}
        </div>
        {p.base && p.changeCount > 0 && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> 바뀐 것만 보기
          </label>
        )}
      </header>

      <Body payload={p} role={role} onlyChanged={onlyChanged} />
      <p className="px-4 pt-6 text-center text-xs text-neutral-400">읽기 전용 · OnePatch · 받은 시각 {when(data.fetchedAt)}</p>
    </main>
  );
}

function Body({ payload: p, role, onlyChanged }: { payload: SharePayload; role: ShareRole; onlyChanged: boolean }) {
  const inLabel = useMemo(() => new Map(p.columns.inputs.map((c) => [c.key, c.label])), [p]);
  const outLabel = useMemo(() => new Map(p.columns.outputs.map((c) => [c.key, c.label])), [p]);
  const isChanged = (r: ShareRow) => !!r.added || !!(r.changed && Object.keys(r.changed).length);
  const inputs = p.inputs.filter((r) => !onlyChanged || isChanged(r));
  const outputs = p.outputs.filter((r) => (role === "monitor" ? r.kind === "aux" : role === "stage" ? String(r.cells.ports ?? "") !== "" : true)).filter((r) => !onlyChanged || isChanged(r));
  const removed = [...p.removed.inputs, ...p.removed.outputs];

  const inputSection = (
    <Section title={`인풋 ${p.inputs.length}ch`} key="in">
      {inputs.map((r) => (
        <Item key={r.id} row={r} fields={ROLE_INPUT_FIELDS[role]} label={inLabel} head={`${r.cells.ch}`} title={String(r.cells.source || r.cells.shortName || "")} compact={role === "monitor"} />
      ))}
      {!inputs.length && <Empty />}
    </Section>
  );
  const outputSection = (
    <Section title={role === "monitor" ? "Aux · IEM" : role === "stage" ? "출력 배선" : "아웃풋"} key="out">
      {outputs.map((r) => (
        <Item key={r.id} row={r} fields={ROLE_OUTPUT_FIELDS[role]} label={outLabel} head={String(r.cells.bus)} title={String(r.cells.name || "")} />
      ))}
      {!outputs.length && <Empty />}
    </Section>
  );
  return (
    <div className="space-y-4 px-3 pt-3">
      {removed.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/40">
          <b>삭제됨</b>: <span className="line-through">{removed.join(", ")}</span>
        </div>
      )}
      {role === "monitor" ? [outputSection, inputSection] : [inputSection, outputSection]}
      {role === "foh" && (p.groups.length > 0 || p.boxes.length > 0) && (
        <Section title="DCA · 뮤트 · 스테이지박스">
          <ul className="space-y-0.5 px-1 text-sm">
            {p.groups.map((g) => (
              <li key={g.kind + g.number} className={g.changed ? "font-semibold" : ""}>
                {g.changed && <Mark />}
                {g.kind === "dca" ? "DCA" : "뮤트"} {g.number} <span className="text-neutral-600 dark:text-neutral-400">{g.name}</span>
              </li>
            ))}
            {p.boxes.map((b) => (
              <li key={b.name} className="text-neutral-600 dark:text-neutral-400">
                {b.name} {b.inputs}in/{b.outputs}out {b.location && `· ${b.location}`}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 px-1 text-xs font-semibold tracking-wide text-neutral-500">{title}</h2>
      <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">{children}</div>
    </section>
  );
}

const Mark = () => <span className="mr-1 text-amber-600 dark:text-amber-400">▲</span>;
const Empty = () => <p className="px-3 py-2 text-sm text-neutral-400">없음</p>;

function Item({ row, fields, label, head, title, compact }: { row: ShareRow; fields: string[]; label: Map<string, string>; head: string; title: string; compact?: boolean }) {
  const changed = row.changed ?? {};
  const mark = row.added || Object.keys(changed).length > 0;
  // 역할 칸 + (역할 칸에 없어도) 바뀐 칸은 늘 보인다. 제목 칸(Ch·소스·버스·이름)은 제목 줄에서.
  const TITLE = ["ch", "source", "bus", "name"];
  const extra = Object.keys(changed).filter((k) => !fields.includes(k) && !TITLE.includes(k));
  const shown = [...fields.filter((f) => String(row.cells[f] ?? "") !== "" || f in changed), ...extra];
  const titleKey = TITLE.find((k) => k !== "ch" && k !== "bus" && k in changed);
  const titleChanged = !!titleKey;
  return (
    <div className={`px-3 py-2 ${mark ? "bg-amber-50 dark:bg-amber-950/30" : "bg-white dark:bg-neutral-950"}`}>
      <div className="flex items-baseline gap-2">
        <span className="w-10 shrink-0 font-mono text-sm font-bold tabular-nums">
          {mark && <Mark />}
          {head}
        </span>
        {row.color && row.color !== "none" && <span className="inline-block h-3 w-1.5 shrink-0 rounded-sm" style={{ background: COLOR_SWATCH[row.color] }} />}
        <span className={`min-w-0 flex-1 truncate ${titleChanged ? "font-semibold" : "font-medium"}`}>{title}</span>
        {row.added && <span className="rounded bg-green-100 px-1 text-[11px] text-green-800 dark:bg-green-950 dark:text-green-200">추가</span>}
      </div>
      {titleKey && (
        <div className="pl-12 text-[12px] text-neutral-500">
          {label.get(titleKey)} <span className="line-through">{changed[titleKey] || "—"}</span> → 바뀜
        </div>
      )}
      {shown.length > 0 && (
        <div className={`mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-12 ${compact ? "text-[12px]" : "text-[13px]"}`}>
          {shown.map((f) =>
            f in changed ? (
              <span key={f} className="rounded bg-amber-200/70 px-1 dark:bg-amber-800/60">
                <span className="text-neutral-600 dark:text-neutral-300">{label.get(f)} </span>
                <span className="line-through opacity-60">{changed[f] || "—"}</span> → <b>{String(row.cells[f] ?? "") || "—"}</b>
              </span>
            ) : (
              <span key={f}>
                <span className="text-neutral-500">{label.get(f)} </span>
                {String(row.cells[f])}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
