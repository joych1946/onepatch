import type { Metadata } from "next";
import LibraryView from "@/components/LibraryView";

export const metadata: Metadata = { title: "내 장비·소스 — OnePatch" };

export default function LibraryPage() {
  return <LibraryView />;
}
