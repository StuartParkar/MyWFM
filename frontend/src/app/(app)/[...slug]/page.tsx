import { notFound } from "next/navigation";
import { findNavLeaf } from "@/lib/nav/navTree";
import { ComingSoon } from "@/components/ComingSoon";

/**
 * Catches every nav leaf that isn't backed by a real page yet (workforce/*,
 * roster/*, intraday/*, operations/*, reports/*, data/*, ...). system/* and
 * admin/* have their own local catch-alls (see the sibling directories)
 * because each of those sections also contains at least one real page, and
 * Next.js resolves a static sibling route before falling back to an ancestor
 * catch-all - see database/schema/README.md-style reasoning in navTree.ts.
 */
export default async function AppCatchAllPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const leaf = findNavLeaf(`/${(slug ?? []).join("/")}`);
  if (!leaf) notFound();
  return <ComingSoon leaf={leaf} />;
}
