import { Suspense } from "react";
import ShowView from "@/components/ShowView";

export default function ShowPage({ params }: PageProps<"/shows/[id]">) {
  return (
    <Suspense fallback={<main className="p-6 text-neutral-500">불러오는 중…</main>}>
      <ShowViewWithId params={params} />
    </Suspense>
  );
}

async function ShowViewWithId({ params }: { params: PageProps<"/shows/[id]">["params"] }) {
  const { id } = await params;
  return <ShowView id={id} />;
}
