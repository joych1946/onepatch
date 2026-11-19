"use client";

/** 주소의 ?id=를 읽어 화면에 넘긴다 (페이지를 고정 파일로 두기 위해 id는 브라우저에서 읽는다) */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ShowView from "./ShowView";
import PrintView from "./print/PrintView";
import ConsoleExportView from "./ConsoleExportView";
import VersionsView from "./VersionsView";
import ShareView from "./ShareView";

export default function WithShowId({ view }: { view: "show" | "print" | "console" | "versions" | "share" }) {
  const id = useSearchParams().get("id");
  if (!id)
    return (
      <main className="p-6">
        Show가 지정되지 않았습니다. <Link href="/" className="underline">목록으로</Link>
      </main>
    );
  if (view === "print") return <PrintView key={id} id={id} />;
  if (view === "console") return <ConsoleExportView key={id} id={id} />;
  if (view === "versions") return <VersionsView key={id} id={id} />;
  if (view === "share") return <ShareView key={id} id={id} />;
  return <ShowView key={id} id={id} />;
}
