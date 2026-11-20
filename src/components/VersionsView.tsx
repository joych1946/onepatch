"use client";

/**
 * 버전 화면: 이름 붙여 저장, 목록, 두 버전 비교(인풋·아웃풋·패치·DCA·뮤트), 변경분 인쇄, 되돌리기.
 * 버전 내용은 비교할 때만 읽는다 (목록은 가벼운 정보만).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Show } from "@/model/schema";
import { contentFingerprint, currentVersion, defaultBase, DIFF_SECTIONS, diffShows, suggestVersionName, type RowChange, type ShowDiff, type VersionMeta } from "@/model/versions";
import { deleteVersion, getVersionShow, listVersions, saveVersion } from "@/storage/versionStore";
import { showDocumentTitle } from "@/model/showInfo";
import { escGoesBack } from "@/lib/download";
import { routes } from "@/lib/routes";
import { useShowDoc } from "./useShowDoc";

export const CURRENT = "current";
const PRINT_KEY = "onepatch.print";
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
const btn = "rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";

/** 버전 저장: Show의 버전 칸도 그 이름으로 (인쇄 머리말에 나옴) */
export async function saveNamedVersion(show: Show, name: string, apply: (fn: (s: Show) => Show) => void): Promise<VersionMeta> {
  const v = name.trim();
  const meta = await saveVersion({ ...show, version: v }, v);
  apply((s) => (s.version === v ? s : { ...s, version: v }));
  return meta;
}

export function useVersions(showId: string) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const reload = useCallback(() => listVersions(showId).then(setVersions), [showId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { versions, reload };
}

export default function VersionsView({ id }: { id: string }) {
  const doc = useShowDoc(id);
  const { show } = doc;
  const router = useRouter();
  const { versions, reload } = useVersions(id);
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string>(CURRENT);
  const [loaded, setLoaded] = useState<Record<string, Show>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!escGoesBack(e)) return;
      e.preventDefault();
      router.push(routes.show(id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, id]);

  const title = show?.title;
  useEffect(() => {
    if (title === undefined) return;
    const prev = document.title;
    document.title = showDocumentTitle({ title }, "버전");
    return () => {
      document.title = prev;
    };
  }, [title]);

  const fp = useMemo(() => (show ? contentFingerprint(show) : ""), [show]);
  const same = versions ? currentVersion(versions, fp) : null;

  // 처음: 이름 제안, 비교 기본값 (이후 = 지금, 이전 = 기준)
  useEffect(() => {
    if (!versions || !show) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName((n) => n || suggestVersionName(versions));
    setFrom((f) => f ?? defaultBase(versions, fp)?.id ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // 버전 목록이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions]);

  // 비교할 버전 내용 읽기
  useEffect(() => {
    for (const v of [from, to]) if (v && v !== CURRENT && !loaded[v]) void getVersionShow(v).then((s) => setLoaded((m) => ({ ...m, [v]: s })));
  }, [from, to, loaded]);

  const pick = (v: string | null) => (v === CURRENT ? show : v ? loaded[v] : null);
  const a = pick(from);
  const b = pick(to);
  const diff = useMemo(() => (a && b ? diffShows(a, b) : null), [a, b]);
  const label = (v: string | null) => (v === CURRENT ? (same ? `${same.name} (지금)` : "지금 (편집 중)") : (versions?.find((x) => x.id === v)?.name ?? "—"));

  if (doc.loadError) return <main className="p-6 whitespace-pre-wrap text-red-600">{doc.loadError}</main>;
  if (doc.notFound)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show || !versions) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const save = async () => {
    if (!name.trim()) return;
    const meta = await saveNamedVersion(show, name, doc.apply);
    await reload();
    setMessage(`버전 “${meta.name}”을(를) 저장했습니다.`);
    setName("");
    setTo(CURRENT);
    setFrom(versions[0]?.id ?? null);
  };

  const revert = async (v: VersionMeta) => {
    if (!confirm(`“${v.name}”(${when(v.createdAt)})으로 되돌릴까요? 지금 상태는 “되돌리기 전” 버전으로 남겨 둡니다.`)) return;
    const target = await getVersionShow(v.id);
    if (!same) await saveVersion(show, `되돌리기 전 (${when(new Date().toISOString())})`);
    doc.apply(() => ({ ...target, id: show.id, createdAt: show.createdAt }));
    await reload();
    setMessage(`“${v.name}”으로 되돌렸습니다. Show 화면에서 실행 취소할 수도 있습니다.`);
  };

  const remove = async (v: VersionMeta) => {
    if (!confirm(`버전 “${v.name}”을(를) 지울까요?`)) return;
    await deleteVersion(v.id);
    if (from === v.id) setFrom(null);
    if (to === v.id) setTo(CURRENT);
    await reload();
  };

  const printChanges = () => {
    try {
      const cur = JSON.parse(localStorage.getItem(PRINT_KEY) ?? "{}");
      localStorage.setItem(PRINT_KEY, JSON.stringify({ ...cur, doc: "changes", changesFrom: from ?? "auto", changesTo: to }));
    } catch {}
    router.push(routes.print(id));
  };

  return (
    <main className="mx-auto w-full max-w-[1100px] space-y-5 p-4 text-sm sm:p-6">
      <header>
        <Link href={routes.show(id)} className="text-neutral-500 hover:underline">
          ← {show.title} <kbd>Esc</kbd>
        </Link>
        <h1 className="mt-1 text-2xl font-bold">버전</h1>
        <p className="text-neutral-500">“v1 사전 배포”, “v2 리허설 후”처럼 이름을 붙여 지금 상태를 남기고, 두 버전 사이에 바뀐 것을 보거나 바뀐 것만 인쇄합니다. 이 브라우저에만 저장됩니다(전체 백업에 포함).</p>
      </header>

      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-label="버전 저장">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex items-center gap-2">
            새 버전 이름
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="새 버전 이름" placeholder="v2 리허설 후" className="w-56 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700" />
          </label>
          <button type="submit" className={`${btn} border-blue-500 font-medium text-blue-700 dark:text-blue-300`} disabled={!name.trim()}>
            지금 상태를 버전으로 저장
          </button>
          <span className="text-xs text-neutral-500">{same ? `지금 내용은 “${same.name}”과 같습니다.` : versions.length ? "마지막 버전 이후 바뀐 내용이 있습니다." : "아직 저장한 버전이 없습니다."}</span>
        </form>
        {message && (
          <p role="status" className="mt-2 text-green-700 dark:text-green-300">
            {message}
          </p>
        )}
      </section>

      {versions.length > 0 && (
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-2 font-semibold">저장한 버전 ({versions.length})</h2>
          <table className="w-full border-collapse text-left" aria-label="저장한 버전">
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1.5 pr-3 font-medium">
                    {v.name}
                    {same?.id === v.id && <span className="ml-2 rounded bg-green-100 px-1.5 text-xs text-green-800 dark:bg-green-950 dark:text-green-200">지금과 같음</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-neutral-500 tabular-nums">{when(v.createdAt)}</td>
                  <td className="hidden py-1.5 pr-3 text-neutral-500 sm:table-cell">
                    {v.inputs}ch · 버스 {v.outputs}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button className="px-1.5 hover:underline" onClick={() => setFrom(v.id)}>
                      이전으로
                    </button>
                    <button className="px-1.5 hover:underline" onClick={() => setTo(v.id)}>
                      이후로
                    </button>
                    <button className="px-1.5 hover:underline" onClick={() => void revert(v)} disabled={same?.id === v.id}>
                      되돌리기
                    </button>
                    <button className="px-1.5 text-red-600 hover:underline" onClick={() => void remove(v)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-label="버전 비교">
        <h2 className="mb-2 font-semibold">비교</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select aria-label="이전" value={from ?? ""} onChange={(e) => setFrom(e.target.value || null)} className="rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700">
            <option value="">이전 버전 고르기</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({when(v.createdAt)})
              </option>
            ))}
          </select>
          <span>→</span>
          <select aria-label="이후" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700">
            <option value={CURRENT}>지금 (편집 중)</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({when(v.createdAt)})
              </option>
            ))}
          </select>
          <button className={btn} onClick={printChanges} disabled={!diff}>
            변경분 인쇄
          </button>
        </div>
        {!from && <p className="text-neutral-500">비교할 이전 버전을 고르세요. 버전이 없으면 먼저 저장하세요.</p>}
        {diff && <DiffView diff={diff} fromLabel={label(from)} toLabel={label(to)} />}
      </section>
    </main>
  );
}

const KIND_LABEL: Record<RowChange["kind"], string> = { added: "추가", removed: "삭제", changed: "변경" };
const KIND_CLASS: Record<RowChange["kind"], string> = {
  added: "bg-green-50 dark:bg-green-950/40",
  removed: "bg-red-50 text-neutral-500 line-through dark:bg-red-950/40",
  changed: "",
};

export function DiffView({ diff, fromLabel, toLabel }: { diff: ShowDiff; fromLabel: string; toLabel: string }) {
  if (!diff.total) return <p className="text-green-700 dark:text-green-300">“{fromLabel}”과 “{toLabel}” 사이에 바뀐 것이 없습니다.</p>;
  const counts = DIFF_SECTIONS.map((s) => `${s.title} ${diff[s.key].length}`).join(" · ");
  return (
    <div className="space-y-4">
      <p>
        <b>
          {fromLabel} → {toLabel}
        </b>
        : 바뀐 것 {diff.total}개 <span className="text-neutral-500">({counts}{diff.info.length ? ` · 공연 정보 ${diff.info.length}` : ""})</span>
      </p>
      {diff.info.length > 0 && <FieldList title="공연 정보" fields={diff.info} />}
      {DIFF_SECTIONS.map(({ key, title }) =>
        diff[key].length ? (
          <div key={key}>
            <h3 className="mb-1 font-medium">
              {title} ({diff[key].length})
            </h3>
            <table className="w-full border-collapse text-left text-xs" aria-label={`${title} 변경`}>
              <tbody>
                {diff[key].map((r) => (
                  <tr key={r.kind + r.id} className={`border-t border-neutral-200 align-top dark:border-neutral-800 ${KIND_CLASS[r.kind]}`}>
                    <td className="w-12 py-1 pr-2 font-medium">{KIND_LABEL[r.kind]}</td>
                    <td className="w-48 py-1 pr-2 font-semibold">{r.label}</td>
                    <td className="py-1">
                      {r.fields.map((f, i) => (
                        <span key={i} className="mr-3 inline-block">
                          <span className="text-neutral-500">{f.field}</span> <span className="text-red-700 line-through decoration-red-300 dark:text-red-300">{f.before || "—"}</span> →{" "}
                          <span className="rounded bg-yellow-100 px-0.5 font-medium dark:bg-yellow-900/50">{f.after || "—"}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null,
      )}
    </div>
  );
}

function FieldList({ title, fields }: { title: string; fields: { field: string; before: string; after: string }[] }) {
  return (
    <div>
      <h3 className="mb-1 font-medium">{title}</h3>
      <ul className="text-xs">
        {fields.map((f, i) => (
          <li key={i}>
            <span className="text-neutral-500">{f.field}</span> <span className="line-through">{f.before || "—"}</span> → <b>{f.after || "—"}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
