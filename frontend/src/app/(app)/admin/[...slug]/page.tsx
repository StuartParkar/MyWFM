import { notFound } from "next/navigation";
import { findNavLeaf } from "@/lib/nav/navTree";
import { ComingSoon } from "@/components/ComingSoon";

export default async function AdminCatchAllPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const leaf = findNavLeaf(`/admin/${(slug ?? []).join("/")}`);
  if (!leaf) notFound();
  return <ComingSoon leaf={leaf} />;
}
