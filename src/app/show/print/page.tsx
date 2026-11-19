import { Suspense } from "react";
import WithShowId from "@/components/WithShowId";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-neutral-500">불러오는 중…</main>}>
      <WithShowId view="print" />
    </Suspense>
  );
}
