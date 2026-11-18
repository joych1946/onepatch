import { Suspense } from "react";
import PrintView from "@/components/print/PrintView";

export default function PrintPage({ params }: PageProps<"/shows/[id]/print">) {
  return (
    <Suspense fallback={<main className="p-6 text-neutral-500">불러오는 중…</main>}>
      <PrintWithId params={params} />
    </Suspense>
  );
}

async function PrintWithId({ params }: { params: PageProps<"/shows/[id]/print">["params"] }) {
  const { id } = await params;
  return <PrintView id={id} />;
}
