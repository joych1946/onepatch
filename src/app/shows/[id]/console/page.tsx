import { Suspense } from "react";
import ConsoleExportView from "@/components/ConsoleExportView";

export default function ConsolePage({ params }: PageProps<"/shows/[id]/console">) {
  return (
    <Suspense fallback={<main className="p-6 text-neutral-500">불러오는 중…</main>}>
      <ConsoleWithId params={params} />
    </Suspense>
  );
}

async function ConsoleWithId({ params }: { params: PageProps<"/shows/[id]/console">["params"] }) {
  const { id } = await params;
  return <ConsoleExportView id={id} />;
}
