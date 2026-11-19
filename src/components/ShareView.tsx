"use client";

/**
 * 크루 공유 (감독님 화면): 고정 링크·QR 만들기, "공유 업데이트", 변경 표시 기준 고르기, 공유 중지.
 * 서버(/api/share)에는 크루 화면용 내용(SharePayload)만 올리고, 편집 데이터는 계속 이 브라우저에만 둔다.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import qrcode from "qrcode-generator";
import type { Show } from "@/model/schema";
import { buildSharePayload } from "@/model/share";
import { contentFingerprint, defaultBase, type VersionMeta } from "@/model/versions";
import { getVersionShow, listVersions } from "@/storage/versionStore";
import { deleteShareLink, getShareLink, putShareLink, type ShareLink } from "@/storage/shareLinks";
import { showDocumentTitle } from "@/model/showInfo";
import { isTypingTarget } from "@/lib/download";
import { routes } from "@/lib/routes";
import { useShowDoc } from "./useShowDoc";

const LAST = "last";
const NONE = "none";
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
const btn = "rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800";

export function crewUrl(id: string): string {
  return `${location.origin}${routes.crew(id)}`;
}

export default function ShareView({ id }: { id: string }) {
  const doc = useShowDoc(id);
  const { show } = doc;
  const router = useRouter();
  const [link, setLink] = useState<ShareLink | null | undefined>(undefined);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [baseSel, setBaseSel] = useState<string | null>(null);
  const [baseShow, setBaseShow] = useState<Show | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void getShareLink(id).then(setLink);
    void listVersions(id).then(setVersions);
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      router.push(routes.show(id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, id]);

  const title = show?.title;
  useEffect(() => {
    if (title === undefined) return;
    const prev = document.title;
    document.title = showDocumentTitle({ title }, "크루 공유");
    return () => {
      document.title = prev;
    };
  }, [title]);

  const fp = useMemo(() => (show ? contentFingerprint(show) : ""), [show]);
  // 기본 기준: 지난 공유본, 없으면 버전 기준(11단계와 같은 규칙)
  const sel = baseSel ?? (link ? LAST : (defaultBase(versions, fp)?.id ?? NONE));
  useEffect(() => {
    if (sel === LAST || sel === NONE) return;
    let alive = true;
    void getVersionShow(sel).then((s) => alive && setBaseShow(s));
    return () => {
      alive = false;
    };
  }, [sel]);
  const base = useMemo(() => {
    if (sel === NONE) return null;
    if (sel === LAST) return link ? { show: link.lastPublished, label: "지난 공유", at: link.publishedAt } : null;
    const v = versions.find((x) => x.id === sel);
    return v && baseShow ? { show: baseShow, label: v.name, at: v.createdAt } : null;
  }, [sel, link, versions, baseShow]);
  const preview = useMemo(() => (show ? buildSharePayload(show, base) : null), [show, base]);
  const unchangedSinceShare = link && show ? contentFingerprint(link.lastPublished) === fp : false;

  if (doc.loadError) return <main className="p-6 whitespace-pre-wrap text-red-600">{doc.loadError}</main>;
  if (doc.notFound)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show || link === undefined || !preview) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = buildSharePayload(show, base);
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(link ? { id: link.id, key: link.key, payload } : { payload }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; key?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? `서버 응답 ${res.status}`);
      const next: ShareLink = { showId: id, id: body.id, key: body.key ?? link!.key, publishedAt: payload.publishedAt, lastPublished: show };
      await putShareLink(next);
      setLink(next);
      setBaseSel(null);
      setMessage({
        kind: "info",
        text: link
          ? `공유를 업데이트했습니다. 크루는 같은 링크를 새로고침하면 됩니다${payload.changeCount ? ` (바뀐 것 ${payload.changeCount}개 표시)` : ""}.`
          : "공유를 시작했습니다. 아래 링크나 QR을 크루에게 보내세요.",
      });
    } catch (e) {
      setMessage({ kind: "error", text: `공유하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!link || !confirm("공유를 중지할까요? 크루의 링크가 더 이상 열리지 않습니다(이미 받아 둔 화면은 남을 수 있음).")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: link.id, key: link.key, stop: true }) });
      if (!res.ok && res.status !== 404) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? String(res.status));
      await deleteShareLink(id);
      setLink(null);
      setMessage({ kind: "info", text: "공유를 중지했습니다." });
    } catch (e) {
      setMessage({ kind: "error", text: `중지하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const url = link ? crewUrl(link.id) : "";
  return (
    <main className="mx-auto w-full max-w-[900px] space-y-5 p-4 text-sm sm:p-6">
      <header>
        <Link href={routes.show(id)} className="text-neutral-500 hover:underline">
          ← {show.title} <kbd>Esc</kbd>
        </Link>
        <h1 className="mt-1 text-2xl font-bold">크루 공유</h1>
        <p className="text-neutral-500">
          크루가 폰으로 최신 인풋리스트를 보는 고정 링크입니다. 로그인 없이 열리고 편집은 안 됩니다. 내용을 고친 뒤 “공유 업데이트”를 누르면 크루는 같은 링크를 새로고침만 하면 됩니다.
        </p>
      </header>

      {link && (
        <section className="flex flex-wrap items-start gap-5 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-label="공유 링크">
          <Qr text={url} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-xs text-neutral-500">크루 링크 (QR을 무대·콘솔 옆에 붙여 두세요)</div>
            <div className="font-mono text-sm break-all">{url}</div>
            <div className="flex flex-wrap gap-2">
              <button
                className={btn}
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(
                    () => setMessage({ kind: "info", text: "링크를 복사했습니다." }),
                    () => setMessage({ kind: "error", text: "복사하지 못했습니다. 링크를 길게 눌러 복사하세요." }),
                  )
                }
              >
                링크 복사
              </button>
              <a className={btn} href={url} target="_blank" rel="noreferrer">
                크루 화면 열기
              </a>
              <button className={`${btn} text-red-600`} onClick={() => void stop()} disabled={busy || !online}>
                공유 중지
              </button>
            </div>
            <div className="text-xs text-neutral-500">
              마지막 공유 {when(link.publishedAt)}
              {unchangedSinceShare ? " · 그 뒤로 바뀐 것 없음" : " · 그 뒤로 고친 내용이 있습니다"}
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800" aria-label="공유 업데이트">
        <label className="flex flex-wrap items-center gap-2">
          크루 화면의 변경 표시(▲) 기준
          <select
            aria-label="변경 표시 기준"
            value={sel}
            onChange={(e) => setBaseSel(e.target.value)}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
          >
            {link && <option value={LAST}>지난 공유 ({when(link.publishedAt)})</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                버전 {v.name}
              </option>
            ))}
            <option value={NONE}>표시 안 함</option>
          </select>
        </label>
        <p>
          {base ? (
            <>
              “{base.label}” 이후 바뀐 것 <b>{preview.changeCount}개</b>
              {preview.changeCount > 0 && (
                <span className="text-neutral-500">
                  {" "}
                  (인풋 {preview.inputs.filter((r) => r.changed || r.added).length + preview.removed.inputs.length} · 아웃풋{" "}
                  {preview.outputs.filter((r) => r.changed || r.added).length + preview.removed.outputs.length})
                </span>
              )}
              가 크루 화면에 ▲로 표시됩니다.
            </>
          ) : (
            "변경 표시 없이 공유합니다."
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={`${btn} border-blue-500 font-medium text-blue-700 dark:text-blue-300`} onClick={() => void publish()} disabled={busy || !online}>
            {busy ? "보내는 중…" : link ? "공유 업데이트" : "공유 시작 (링크 만들기)"}
          </button>
          {!online && <span className="text-amber-700">오프라인이라 공유할 수 없습니다. 인터넷이 될 때 다시 누르세요.</span>}
        </div>
        {message && (
          <p role="status" className={message.kind === "error" ? "text-red-600" : "text-green-700 dark:text-green-300"}>
            {message.text}
          </p>
        )}
        <p className="text-xs text-neutral-500">
          서버에는 크루 화면에 보이는 값(인풋·아웃풋 리스트, DCA·뮤트 이름)만 올라갑니다. 링크를 아는 사람은 누구나 볼 수 있으니 공개하면 안 되는 내용은 비고에 쓰지 마세요. 업데이트 키는 이
          브라우저와 전체 백업에만 있습니다.
        </p>
      </section>
    </main>
  );
}

/** QR (SVG로 직접 그림) */
function Qr({ text }: { text: string }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, path: d };
  }, [text]);
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={176} height={176} role="img" aria-label="크루 링크 QR 코드" className="shrink-0 rounded bg-white" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
