"use client";

/** Show 화면: 탭(인풋 / 아웃풋 / DCA·뮤트) + 아직 편집 화면이 없는 항목은 읽기 전용 보기 */
import { useEffect, useState } from "react";
import { routes } from "@/lib/routes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Show } from "@/model/schema";
import { showFileName, showToJson } from "@/model/serialize";
import { MIC_TYPE_LABEL } from "@/model/labels";
import { downloadText, isTypingTarget } from "@/lib/download";
import InputGrid from "./InputGrid";
import OutputsView from "./OutputsView";
import GroupsView from "./GroupsView";
import PatchView from "./PatchView";
import IssuesPanel from "./IssuesPanel";
import { SaveNameDialog } from "./TemplateDialogs";
import { makeShowTemplate } from "@/model/templates";
import { FIELD_TO_COL, type ColKey } from "@/model/inputColumns";
import type { GroupKind } from "@/model/outputOps";
import { busIssueCell } from "@/model/outputColumns";
import type { BusKind, InputChannel } from "@/model/schema";
import { useShowDoc, type SaveStatus } from "./useShowDoc";
import { useLibrary } from "./useLibrary";
import { quantityIssues } from "@/model/library";
import { applyShowInfo, EDIT_TITLE_KEY, showDocumentTitle, showInfoOf } from "@/model/showInfo";
import { ShowInfoDialog, TitleEditor } from "./ShowInfo";

const RENUMBER_KEY = "onepatch.renumber";
const TAB_KEY = "onepatch.showTab";
type Tab = "inputs" | "outputs" | "groups" | "patch";
const TABS: Tab[] = ["inputs", "outputs", "groups", "patch"];
/** 오류 검사 패널에서 누른 칸으로 이동 요청 */
type FocusReq = { tab: Tab; kind?: string; row: number; col: string; n: number };

type Message = { text: string; details?: string[] };

export default function ShowView({ id }: { id: string }) {
  const router = useRouter();
  const doc = useShowDoc(id);
  const lib = useLibrary();
  const { show } = doc;
  const [message, setMessage] = useState<Message | null>(null);
  const [renumber, setRenumber] = useState(true);
  const [tab, setTabState] = useState<Tab>("inputs");
  const [focusReq, setFocusReq] = useState<FocusReq | null>(null);
  const [savingTpl, setSavingTpl] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const overlay = editingTitle || infoOpen || savingTpl;

  // 새로 만든 Show면 공연명 입력 상태로 시작
  useEffect(() => {
    try {
      if (sessionStorage.getItem(EDIT_TITLE_KEY) === id) {
        sessionStorage.removeItem(EDIT_TITLE_KEY);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEditingTitle(true);
      }
    } catch {}
  }, [id]);

  // 브라우저 탭 제목
  const title = show?.title;
  useEffect(() => {
    if (title === undefined) return;
    const prev = document.title;
    document.title = showDocumentTitle({ title });
    return () => {
      document.title = prev;
    };
  }, [title]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(RENUMBER_KEY);
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      /* eslint-disable react-hooks/set-state-in-effect */
      if (v !== null) setRenumber(v === "1");
      if (t && TABS.includes(t)) setTabState(t);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    setMessage(null);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };

  const toggleRenumber = (v: boolean) => {
    setRenumber(v);
    try {
      localStorage.setItem(RENUMBER_KEY, v ? "1" : "0");
    } catch {}
  };

  const exportJson = () => show && downloadText(showFileName(show), showToJson(show));

  // ⌥/Alt+1·2·3: 탭 전환 (그리드 안에서도)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = e.code.match(/^Digit([1-4])$/);
      if (!m || !e.altKey || e.metaKey || e.ctrlKey || overlay) return;
      e.preventDefault();
      setTab(TABS[Number(m[1]) - 1]);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || overlay || isTypingTarget(e.target)) return;
      // 그리드 밖(예: 공연명을 고친 직후)에서도 실행 취소/다시 실행. 그리드 안에서는 그리드가 먼저 처리한다.
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) doc.undo();
        else if ((k === "z" && e.shiftKey) || k === "y") doc.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") router.push("/");
      else if (e.key === "i") setInfoOpen(true);
      else if (e.key === "F2") setEditingTitle(true);
      else if (e.key === "e") exportJson();
      else if (e.key === "p" && show) router.push(routes.print(show.id));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (doc.loadError) return <main className="p-6 text-red-600 whitespace-pre-wrap">{doc.loadError}</main>;
  if (doc.notFound)
    return (
      <main className="p-6">
        Show를 찾을 수 없습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (!show) return <main className="p-6 text-neutral-500">불러오는 중…</main>;

  // 보유 수량 초과는 내 라이브러리와 비교해야 알 수 있으므로 여기서 더한다
  const warnings = [...doc.warnings, ...(lib.library ? quantityIssues(lib.library, show) : [])];
  const allIssues = [...doc.errors, ...warnings];
  const area = (i: { path: PropertyKey[] }): Tab | null =>
    i.path[0] === "inputs"
      ? "inputs"
      : i.path[0] === "outputs"
        ? "outputs"
        : i.path[0] === "dcas" || i.path[0] === "muteGroups"
          ? "groups"
          : i.path[0] === "stageBoxes"
            ? "patch"
            : null;
  const issueCount = (t: Tab) => allIssues.filter((i) => area(i) === t).length;

  /** 오류 검사 패널에서 누른 문제의 칸으로 이동 */
  const goTo = (i: { path: PropertyKey[] }) => {
    const t = area(i);
    const row = typeof i.path[1] === "number" ? i.path[1] : 0;
    const n = (focusReq?.n ?? 0) + 1;
    if (t === "inputs")
      setFocusReq({ tab: t, row, col: FIELD_TO_COL[i.path[2] as keyof InputChannel] ?? "source", n });
    else if (t === "outputs") {
      const cell = busIssueCell(show, i.path);
      if (cell) setFocusReq({ tab: t, kind: cell.kind, row: cell.row, col: cell.col, n });
    } else if (t === "groups") setFocusReq({ tab: t, kind: i.path[0] === "dcas" ? "dca" : "mute", row, col: "num", n });
    else if (t === "patch") setFocusReq({ tab: t, row, col: "name", n });
    if (t && t !== tab) setTabState(t);
  };
  const req = (t: Tab) => (focusReq?.tab === t ? focusReq : null);
  const onMessage = (text: string, details?: string[]) => setMessage({ text, details });
  const btn =
    "rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40";

  return (
    <main className="mx-auto w-full max-w-[1400px] p-6 text-sm">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <Link href="/" className="text-neutral-500 hover:underline">
            ← 목록
          </Link>
          <div className="mt-1 flex flex-wrap items-start gap-2">
            <h1 className="text-2xl font-bold">
              <TitleEditor
                title={show.title}
                editing={editingTitle}
                setEditing={setEditingTitle}
                onCommit={(t) => doc.apply((s) => applyShowInfo(s, { title: t }))}
                className="px-1 -mx-1"
              />
            </h1>
            {!editingTitle && (
              <button className="mt-1 rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800" onClick={() => setInfoOpen(true)} title="공연명·날짜·장소·작성자·버전·메모 (I)">
                공연 정보
              </button>
            )}
          </div>
          <button type="button" className="text-left text-neutral-500 hover:underline" onClick={() => setInfoOpen(true)} title="공연 정보 고치기 (I)">
            {[show.date, show.venue, show.author && `작성 ${show.author}`, show.version].filter(Boolean).join(" · ") || "날짜·장소·작성자·버전 입력"}
          </button>
        </div>
        <Link href="/library" className={`${btn} self-center`}>
          내 장비·소스
        </Link>
        <SaveBadge status={doc.status} warnings={warnings.length} />
        <button className={btn} onClick={doc.undo} disabled={!doc.canUndo} title="⌘Z / Ctrl+Z">
          실행 취소
        </button>
        <button className={btn} onClick={doc.redo} disabled={!doc.canRedo} title="⇧⌘Z / Ctrl+Y">
          다시 실행
        </button>
        <Link href={routes.console(show.id)} className={`${btn} self-center`} title="DM Editor 쇼 파일(.dmxf)에 인풋 설정 넣기">
          콘솔 내보내기
        </Link>
        <Link href={routes.print(show.id)} className={`${btn} self-center`} title="인풋·아웃풋 리스트, 패치 시트, 집계표, 라벨, 엑셀 (P)">
          출력·인쇄
        </Link>
        <button className={btn} onClick={() => setSavingTpl(true)} disabled={!lib.library} title="이 Show의 스테이지박스·아웃풋·DCA·인풋을 새 Show의 틀로 저장">
          Show 템플릿으로 저장
        </button>
        <button className={btn} onClick={exportJson}>
          JSON 내보내기
        </button>
      </header>

      <div role="tablist" className="mb-3 flex flex-wrap items-center gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((t, i) => {
          const label =
            t === "inputs"
              ? `인풋 (${show.inputs.length}ch)`
              : t === "outputs"
                ? `아웃풋 (${show.outputs.length})`
                : t === "groups"
                  ? `DCA·뮤트 (${show.dcas.length}/${show.muteGroups.length})`
                  : `패치 (박스 ${show.stageBoxes.length})`;
          const n = issueCount(t);
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(t)}
              title={`⌥/Alt+${i + 1}`}
              className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? "border-blue-600 font-semibold" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
            >
              {label}
              {n > 0 && <span className="ml-1.5 rounded bg-red-100 px-1 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">{n}</span>}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-1.5 py-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input type="checkbox" checked={renumber} onChange={(e) => toggleRenumber(e.target.checked)} />
          행 추가·삭제·이동 시 번호를 순서대로 다시 매기기
        </label>
      </div>

      <IssuesPanel issues={allIssues} blocking={doc.errors.length > 0} onGo={goTo} />

      <section className="mb-8">
        {tab === "inputs" && (
          <InputGrid
            show={show}
            apply={doc.apply}
            undo={doc.undo}
            redo={doc.redo}
            issues={allIssues}
            renumber={renumber}
            onMessage={onMessage}
            library={lib.library}
            updateLibrary={lib.update}
            focusRequest={req("inputs") as { row: number; col: ColKey; n: number } | null}
          />
        )}
        {tab === "outputs" && (
          <OutputsView
            show={show}
            apply={doc.apply}
            undo={doc.undo}
            redo={doc.redo}
            renumber={renumber}
            issues={allIssues}
            onMessage={onMessage}
            focusRequest={req("outputs") as { kind: BusKind; row: number; col: string; n: number } | null}
          />
        )}
        {tab === "groups" && (
          <GroupsView
            show={show}
            apply={doc.apply}
            undo={doc.undo}
            redo={doc.redo}
            renumber={renumber}
            issues={allIssues}
            onMessage={onMessage}
            focusRequest={req("groups") as { kind: GroupKind; row: number; col: string; n: number } | null}
          />
        )}
        {tab === "patch" && (
          <PatchView show={show} apply={doc.apply} undo={doc.undo} redo={doc.redo} issues={allIssues} onMessage={onMessage} focusRequest={req("patch")} />
        )}
        {lib.error && <p className="mt-2 text-xs text-red-600 whitespace-pre-wrap">내 라이브러리: {lib.error}</p>}

        {message && (
          <div className="mt-2 space-y-2 text-xs">
            {(
              <div role="status" className="rounded border border-neutral-300 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                <div className="flex justify-between gap-4">
                  <span>{message.text}</span>
                  <button className="opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>
                    닫기
                  </button>
                </div>
                {message.details && (
                  <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
                    {message.details.map((d, k) => (
                      <li key={k}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <details className="mt-3 text-xs text-neutral-500">
          <summary className="cursor-pointer">키보드 단축키</summary>
          <ul className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <li><kbd>⌥/Alt</kbd>+<kbd>1</kbd>~<kbd>4</kbd> 인풋·아웃풋·DCA·뮤트·패치 탭 전환 · 오류 검사 항목을 누르면 그 칸으로 이동</li>
            <li><b>Ch·버스 번호 칸 클릭</b> 또는 그 열에서 <kbd>Space</kbd> → 눌러서 입력 (<kbd>↑↓</kbd> <kbd>Enter</kbd>, 글자로 검색)</li>
            <li>아웃풋·DCA 표: 맨 아래 행에서 <kbd>↓</kbd>, 맨 윗행에서 <kbd>↑</kbd>로 이웃 표로 이동 · DCA 멤버 칸에 “1-4, 7”</li>
            <li>M/S·Pre/Post 열: <kbd>Space</kbd>로 바꾸기, <kbd>S</kbd>/<kbd>M</kbd>, <kbd>P</kbd> 입력도 됨</li>
            <li><kbd>←↑↓→</kbd> <kbd>Tab</kbd> 이동 · <kbd>Shift</kbd>+방향키 범위 선택 · <kbd>Shift</kbd>+<kbd>Space</kbd> 행 선택</li>
            <li>글자 입력 → 바로 덮어쓰기 · <kbd>Enter</kbd>/<kbd>F2</kbd> 기존 값 편집 · <kbd>Esc</kbd> 취소</li>
            <li>편집 후 <kbd>Enter</kbd> 아래로(Tab으로 시작한 열로 복귀) · 마지막 빈 행에 입력하면 채널 추가</li>
            <li><kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> 선택한 행 전체에 같은 값 입력 (일괄 변경)</li>
            <li>48V·링크 열: <kbd>Space</kbd>/<kbd>Enter</kbd> 켜고 끄기 (여러 행 선택 시 일괄)</li>
            <li><kbd>Delete</kbd> 지우기 (48V·스탠드는 마이크 기본값으로)</li>
            <li><kbd>⌘/Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> 복사·잘라내기·붙여넣기 (엑셀 호환, 헤더 자동 인식)</li>
            <li><kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> 실행 취소 · <kbd>⇧⌘Z</kbd>/<kbd>Ctrl</kbd>+<kbd>Y</kbd> 다시 실행</li>
            <li><kbd>⌥/Alt</kbd>+<kbd>N</kbd> 행 삽입 · <kbd>D</kbd> 복제 · <kbd>⌫</kbd> 삭제 · <kbd>↑↓</kbd> 순서 이동</li>
            <li>공연명을 눌러 바로 고치기(그리드 밖에서 <kbd>F2</kbd>) · <kbd>Enter</kbd> 확정 · <kbd>Esc</kbd> 취소 · 그리드 밖에서 <kbd>I</kbd> 공연 정보</li>
            <li>그리드 밖에서 <kbd>E</kbd> JSON 내보내기 · <kbd>P</kbd> 출력·인쇄 · <kbd>Esc</kbd> 목록 (그리드에서 <kbd>Esc</kbd>로 빠져나옴)</li>
          </ul>
        </details>
      </section>

      <ReadonlySections show={show} />

      {infoOpen && (
        <ShowInfoDialog
          info={showInfoOf(show)}
          onSave={(info) => {
            doc.apply((s) => applyShowInfo(s, info));
            setInfoOpen(false);
          }}
          onClose={() => setInfoOpen(false)}
        />
      )}

      {savingTpl && (
        <SaveNameDialog
          title="Show 템플릿으로 저장"
          description={`스테이지박스 ${show.stageBoxes.length}, 아웃풋 ${show.outputs.length}, DCA ${show.dcas.length}, 뮤트 ${show.muteGroups.length}, 인풋 ${show.inputs.length}ch를 그대로 저장합니다. 목록 화면의 “템플릿으로 새 Show”에서 씁니다.`}
          initial={`${show.title} 틀`}
          onSave={(name) => {
            lib.update((l) => ({ ...l, showTemplates: [...l.showTemplates, makeShowTemplate(name, show)] }));
            setMessage({ text: `Show 템플릿 “${name}”을 저장했습니다. 목록 화면의 “템플릿으로 새 Show”(T)에서 쓸 수 있습니다.` });
            setSavingTpl(false);
          }}
          onClose={() => setSavingTpl(false)}
        />
      )}
    </main>
  );
}

function SaveBadge({ status, warnings }: { status: SaveStatus; warnings: number }) {
  const text =
    status.kind === "saved"
      ? (status.at ? `저장됨 ${status.at}` : "저장됨") + (warnings ? ` · 확인 필요 ${warnings}건` : "")
      : status.kind === "pending"
        ? "저장 중…"
        : status.kind === "invalid"
          ? `저장 안 됨 — 오류 ${status.count}건`
          : `저장 실패: ${status.message}`;
  const color =
    status.kind === "saved" || status.kind === "pending" ? "text-neutral-500" : "text-red-600 font-medium";
  return <span className={`self-center text-xs ${color}`}>{text}</span>;
}

/** 아직 편집 화면이 없는 항목 (다음 단계에서 편집 가능해짐) */
function ReadonlySections({ show }: { show: Show }) {
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="스테이지박스">
          <ul className="space-y-1">
            {show.stageBoxes.map((b) => (
              <li key={b.id}>
                <b>{b.name}</b> {b.inputs}in/{b.outputs}out
                <span className="text-neutral-500"> · {b.location}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={`이 Show의 마이크 (${show.microphones.length})`}>
          <ul className="space-y-1">
            {show.microphones.map((m) => (
              <li key={m.id}>
                {m.model}
                <span className="text-neutral-500">
                  {" "}· {MIC_TYPE_LABEL[m.type]}
                  {m.needsPhantom === null ? " · 48V 미확인" : m.needsPhantom && " · 48V"}
                  {m.defaultStand && ` · ${m.defaultStand}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 overflow-x-auto">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
