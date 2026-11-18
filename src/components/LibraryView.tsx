"use client";

/** 내 장비·소스 관리: 마이크/DI 보유 수량·사용자 정의 마이크, 소스 목록과 추천 마이크 순서 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Color, MicType } from "@/model/schema";
import { COLOR_LABEL, COLOR_SWATCH, MIC_TYPE_LABEL } from "@/model/labels";
import { addMic, addSource, findMicByName, libId, type Library, type LibraryMic, type SourceDef } from "@/model/library";
import { createDefaultLibrary } from "@/model/libraryDefaults";
import { norm } from "@/model/text";
import { useLibrary } from "./useLibrary";

type Update = (fn: (l: Library) => Library) => void;
type Tab = "mics" | "sources";

const TAB_KEY = "onepatch.libraryTab";
const input =
  "rounded border border-neutral-300 bg-transparent px-2 py-1 outline-none focus:ring-2 focus:ring-blue-600 dark:border-neutral-700";
const btn =
  "rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-30 dark:border-neutral-700 dark:hover:bg-neutral-800";
const STANDS = ["톨붐", "숏붐", "스트레이트", "클램프"];

export default function LibraryView() {
  const { library, error, update } = useLibrary();
  const [tab, setTab] = useState<Tab>("mics");

  useEffect(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "mics" || v === "sources") setTab(v);
    } catch {}
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };

  if (error) return <main className="p-6 whitespace-pre-wrap text-red-600">{error}</main>;
  if (!library) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const tabBtn = (t: Tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === t}
      onClick={() => choose(t)}
      className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? "border-blue-600 font-semibold" : "border-transparent text-neutral-500"}`}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto w-full max-w-[1100px] p-4 text-sm sm:p-6">
      <header className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <Link href="/" className="text-neutral-500 hover:underline">
            ← 목록
          </Link>
          <h1 className="mt-1 text-2xl font-bold">내 장비·소스</h1>
          <p className="text-neutral-500">모든 Show에서 함께 쓰는 목록입니다. 바꾸면 자동 저장되고, 다음 입력부터 반영됩니다.</p>
        </div>
      </header>
      <div role="tablist" className="mb-4 flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {tabBtn("mics", `마이크·DI (${library.microphones.length})`)}
        {tabBtn("sources", `소스·추천 마이크 (${library.sources.length})`)}
      </div>
      {tab === "mics" ? <MicsTab library={library} update={update} /> : <SourcesTab library={library} update={update} />}

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
        <button
          className={btn}
          onClick={() => {
            if (confirm("마이크·소스 목록을 처음 기본값으로 되돌립니다. 보유 수량과 직접 추가·수정한 내용이 모두 사라집니다. 계속할까요?"))
              update(() => createDefaultLibrary());
          }}
        >
          기본값으로 초기화
        </button>
      </footer>
    </main>
  );
}

/* ───────────── 마이크·DI ───────────── */

function MicsTab({ library, update }: { library: Library; update: Update }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<MicType | "">("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const setMic = (id: string, patch: Partial<LibraryMic>) =>
    update((l) => ({ ...l, microphones: l.microphones.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  const remove = (m: LibraryMic) => {
    const used = library.sources.filter((s) => s.micIds.includes(m.id));
    if (used.length && !confirm(`${m.model}은(는) 소스 ${used.length}개의 추천에 들어 있습니다. 삭제할까요?`)) return;
    update((l) => ({
      ...l,
      microphones: l.microphones.filter((x) => x.id !== m.id),
      sources: l.sources.map((s) => (s.micIds.includes(m.id) ? { ...s, micIds: s.micIds.filter((i) => i !== m.id) } : s)),
    }));
  };

  const unknown = library.microphones.filter((m) => m.needsPhantom === null);
  const n = norm(q);
  const list = library.microphones.filter(
    (m) =>
      (!n || norm(m.model).includes(n)) && (!type || m.type === type) && (!ownedOnly || (m.owned ?? 0) > 0),
  );

  return (
    <div>
      {unknown.length > 0 && (
        <p className="mb-3 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          48V 필요 여부 미확인 {unknown.length}종: {unknown.map((m) => m.model).join(", ")} — 사양을 확인해 채워주세요.
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${input} w-48`} placeholder="모델 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="모델 검색" />
        <select className={input} value={type} onChange={(e) => setType(e.target.value as MicType | "")} aria-label="종류">
          <option value="">전체 종류</option>
          {(Object.keys(MIC_TYPE_LABEL) as MicType[]).map((t) => (
            <option key={t} value={t}>{MIC_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} />
          보유한 것만
        </label>
        <button
          className={`${btn} ml-auto`}
          onClick={() => {
            const r = addMic(library, "새 마이크", "dynamic");
            update(() => r.lib);
            setQ("");
            setType("");
            setOwnedOnly(false);
            setFocusId(r.mic.id);
          }}
        >
          + 마이크 추가
        </button>
      </div>
      <p className="mb-2 text-xs text-neutral-500">보유 수량을 비워두면 수량을 따지지 않습니다. 숫자를 넣으면 Show에서 그보다 많이 쓸 때 표시됩니다.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-500 dark:border-neutral-700">
              <th className="py-1.5 pr-2 font-medium">모델명</th>
              <th className="py-1.5 pr-2 font-medium">종류</th>
              <th className="py-1.5 pr-2 font-medium">48V</th>
              <th className="py-1.5 pr-2 font-medium">기본 스탠드</th>
              <th className="py-1.5 pr-2 font-medium">보유 수량</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className={`border-b border-neutral-200 dark:border-neutral-800 ${m.needsPhantom === null ? "bg-amber-50/60 dark:bg-amber-950/30" : ""}`}>
                <td className="py-1 pr-2">
                  <DraftInput
                    className={`${input} w-full min-w-48`}
                    value={m.model}
                    autoFocus={focusId === m.id}
                    onCommit={(v) => v.trim() && setMic(m.id, { model: v.trim() })}
                    aria-label="모델명"
                  />
                </td>
                <td className="py-1 pr-2">
                  <select className={input} value={m.type} onChange={(e) => setMic(m.id, { type: e.target.value as MicType })} aria-label="종류">
                    {(Object.keys(MIC_TYPE_LABEL) as MicType[]).map((t) => (
                      <option key={t} value={t}>{MIC_TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <select
                    className={`${input} ${m.needsPhantom === null ? "border-amber-500 text-amber-700" : ""}`}
                    value={m.needsPhantom === null ? "" : m.needsPhantom ? "y" : "n"}
                    onChange={(e) => setMic(m.id, { needsPhantom: e.target.value === "" ? null : e.target.value === "y" })}
                    aria-label="48V"
                  >
                    <option value="y">필요</option>
                    <option value="n">불필요</option>
                    <option value="">미확인</option>
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <DraftInput
                    className={`${input} w-24`}
                    value={m.defaultStand}
                    list="stand-options"
                    placeholder="없음"
                    onCommit={(v) => setMic(m.id, { defaultStand: v.trim() === "없음" ? "" : v.trim() })}
                    aria-label="기본 스탠드"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className={`${input} w-20`}
                    value={m.owned ?? ""}
                    placeholder="—"
                    onChange={(e) => {
                      const v = e.target.value;
                      setMic(m.id, { owned: v === "" ? null : Math.max(0, Math.floor(Number(v)) || 0) });
                    }}
                    aria-label={`${m.model} 보유 수량`}
                  />
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  {m.builtin ? (
                    <span className="text-xs text-neutral-400">기본</span>
                  ) : (
                    <button className={btn} onClick={() => remove(m)} aria-label={`${m.model} 삭제`}>
                      삭제
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="stand-options">
          {STANDS.map((s) => <option key={s} value={s} />)}
          <option value="없음" />
        </datalist>
      </div>
    </div>
  );
}

/* ───────────── 소스·추천 ───────────── */

function SourcesTab({ library, update }: { library: Library; update: Update }) {
  const [q, setQ] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const n = norm(q);

  const setSrc = (id: string, patch: Partial<SourceDef>) =>
    update((l) => ({ ...l, sources: l.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  /** 같은 악기군 안에서 위/아래로 */
  const moveSrc = (id: string, d: -1 | 1) =>
    update((l) => {
      const src = l.sources.find((s) => s.id === id)!;
      const idxs = l.sources.map((s, i) => (s.groupId === src.groupId ? i : -1)).filter((i) => i >= 0);
      const at = idxs.indexOf(l.sources.indexOf(src));
      const swap = idxs[at + d];
      if (swap === undefined) return l;
      const sources = l.sources.slice();
      [sources[idxs[at]], sources[swap]] = [sources[swap], sources[idxs[at]]];
      return { ...l, sources };
    });

  const moveGroup = (id: string, d: -1 | 1) =>
    update((l) => {
      const i = l.groups.findIndex((g) => g.id === id);
      const j = i + d;
      if (j < 0 || j >= l.groups.length) return l;
      const groups = l.groups.slice();
      [groups[i], groups[j]] = [groups[j], groups[i]];
      return { ...l, groups };
    });

  const match = (s: SourceDef) => !n || norm(s.name).includes(n) || norm(s.shortName).includes(n);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${input} w-48`} placeholder="소스 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="소스 검색" />
        <p className="text-xs text-neutral-500">
          추천 마이크는 앞쪽부터 우선입니다. 입력할 때 자주 고른 마이크는 한 칸씩 앞으로 올라옵니다.
        </p>
      </div>
      <div className="space-y-6">
        {library.groups.map((g, gi) => {
          const srcs = library.sources.filter((s) => s.groupId === g.id && match(s));
          if (n && !srcs.length) return null;
          return (
            <section key={g.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <DraftInput
                  className={`${input} w-36 font-semibold`}
                  value={g.name}
                  onCommit={(v) =>
                    v.trim() && update((l) => ({ ...l, groups: l.groups.map((x) => (x.id === g.id ? { ...x, name: v.trim() } : x)) }))
                  }
                  aria-label="악기군 이름"
                />
                <button className={btn} disabled={gi === 0} onClick={() => moveGroup(g.id, -1)} aria-label={`${g.name} 위로`}>↑</button>
                <button className={btn} disabled={gi === library.groups.length - 1} onClick={() => moveGroup(g.id, 1)} aria-label={`${g.name} 아래로`}>↓</button>
                <button
                  className={btn}
                  onClick={() => {
                    const r = addSource(library, "새 소스", g.id);
                    update(() => r.lib);
                    setQ("");
                    setFocusId(r.src.id);
                  }}
                >
                  + 소스 추가
                </button>
                {!library.sources.some((s) => s.groupId === g.id) && library.groups.length > 1 && (
                  <button className={btn} onClick={() => update((l) => ({ ...l, groups: l.groups.filter((x) => x.id !== g.id) }))}>
                    악기군 삭제
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {srcs.map((s, si) => (
                  <SourceRow
                    key={s.id}
                    src={s}
                    library={library}
                    first={si === 0}
                    last={si === srcs.length - 1}
                    autoFocus={focusId === s.id}
                    set={(patch) => setSrc(s.id, patch)}
                    move={(d) => moveSrc(s.id, d)}
                    remove={() => {
                      if (confirm(`소스 "${s.name}"을(를) 삭제할까요?`))
                        update((l) => ({ ...l, sources: l.sources.filter((x) => x.id !== s.id) }));
                    }}
                    update={update}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <button
        className={`${btn} mt-6`}
        onClick={() => update((l) => ({ ...l, groups: [...l.groups, { id: libId("grp"), name: "새 악기군" }] }))}
      >
        + 악기군 추가
      </button>
      <datalist id="mic-options">
        {library.microphones.map((m) => <option key={m.id} value={m.model} />)}
      </datalist>
    </div>
  );
}

function SourceRow({
  src,
  library,
  first,
  last,
  autoFocus,
  set,
  move,
  remove,
  update,
}: {
  src: SourceDef;
  library: Library;
  first: boolean;
  last: boolean;
  autoFocus: boolean;
  set: (patch: Partial<SourceDef>) => void;
  move: (d: -1 | 1) => void;
  remove: () => void;
  update: Update;
}) {
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState("");
  const byId = new Map(library.microphones.map((m) => [m.id, m]));
  const ids = src.micIds.filter((id) => byId.has(id));

  const moveMic = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = ids.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ micIds: next });
  };

  const addMicByName = () => {
    const text = adding.trim();
    if (!text) return;
    let lib = library;
    let m = findMicByName(lib.microphones, text);
    if (!m) {
      if (!confirm(`"${text}"은(는) 마이크 목록에 없습니다. 다이내믹으로 새로 추가할까요? (종류·48V는 마이크·DI 탭에서 고칠 수 있습니다)`)) return;
      const r = addMic(lib, text, "dynamic");
      lib = r.lib;
      m = r.mic;
    }
    const mic = m;
    if (ids.includes(mic.id)) {
      setAddError("이미 들어 있습니다");
      return;
    }
    update(() => ({ ...lib, sources: lib.sources.map((s) => (s.id === src.id ? { ...s, micIds: [...ids, mic.id] } : s)) }));
    setAdding("");
    setAddError("");
  };

  return (
    <li className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={first} onClick={() => move(-1)} aria-label={`${src.name} 위로`}>↑</button>
        <button className={btn} disabled={last} onClick={() => move(1)} aria-label={`${src.name} 아래로`}>↓</button>
        <DraftInput
          className={`${input} w-36 font-medium`}
          value={src.name}
          autoFocus={autoFocus}
          onCommit={(v) => v.trim() && set({ name: v.trim() })}
          aria-label="소스명"
        />
        <DraftInput className={`${input} w-24 font-mono`} value={src.shortName} onCommit={(v) => set({ shortName: v.trim() })} aria-label="짧은 이름" placeholder="짧은 이름" />
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-neutral-400" style={{ background: COLOR_SWATCH[src.color] }} />
          <select className={input} value={src.color} onChange={(e) => set({ color: e.target.value as Color })} aria-label="컬러">
            {(Object.keys(COLOR_LABEL) as Color[]).map((c) => (
              <option key={c} value={c}>{COLOR_LABEL[c]}</option>
            ))}
          </select>
        </span>
        <label className="flex items-center gap-1" title="L/R 두 채널로 넣고 링크">
          <input type="checkbox" checked={src.stereo} onChange={(e) => set({ stereo: e.target.checked })} />
          스테레오
        </label>
        <label className="flex items-center gap-1" title="고를 때마다 번호를 붙임 (가야금 1, 가야금 2…)">
          <input type="checkbox" checked={src.numbered} onChange={(e) => set({ numbered: e.target.checked })} />
          늘 번호
        </label>
        <select className={input} value={src.groupId} onChange={(e) => set({ groupId: e.target.value })} aria-label="악기군">
          {library.groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button className={`${btn} ml-auto`} onClick={remove} aria-label={`${src.name} 삭제`}>삭제</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-neutral-500">추천:</span>
        {ids.map((id, i) => (
          <span key={id} className="inline-flex items-center gap-0.5 rounded-full border border-neutral-300 py-0.5 pr-1 pl-2 dark:border-neutral-700">
            <span className="mr-1 text-xs text-neutral-400">{i + 1}</span>
            {byId.get(id)!.model}
            <button className="rounded px-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-20 dark:hover:bg-neutral-800" disabled={i === 0} onClick={() => moveMic(i, -1)} aria-label={`${byId.get(id)!.model} 앞으로`}>◀</button>
            <button className="rounded px-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-20 dark:hover:bg-neutral-800" disabled={i === ids.length - 1} onClick={() => moveMic(i, 1)} aria-label={`${byId.get(id)!.model} 뒤로`}>▶</button>
            <button className="rounded px-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => set({ micIds: ids.filter((x) => x !== id) })} aria-label={`${byId.get(id)!.model} 빼기`}>×</button>
          </span>
        ))}
        <input
          className={`${input} w-44 text-xs`}
          list="mic-options"
          placeholder="+ 마이크 추가 (Enter)"
          value={adding}
          onChange={(e) => {
            setAdding(e.target.value);
            setAddError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              addMicByName();
            }
          }}
          aria-label={`${src.name} 추천 마이크 추가`}
        />
        {addError && <span className="text-xs text-red-600">{addError}</span>}
      </div>
    </li>
  );
}

/** 입력하는 동안은 화면에만, 포커스를 잃거나 Enter를 누르면 반영 (빈 값으로 저장되는 것 방지) */
function DraftInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
