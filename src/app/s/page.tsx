import { Suspense } from "react";
import type { Metadata } from "next";
import CrewView from "@/components/CrewView";

export const metadata: Metadata = { title: "크루 인풋리스트 — OnePatch", robots: { index: false, follow: false } };

/** 크루 화면 (읽기 전용): /s?id=공유id */
export default function CrewPage() {
  return (
    <Suspense fallback={<main className="p-5 text-neutral-500">불러오는 중…</main>}>
      <CrewView />
    </Suspense>
  );
}
