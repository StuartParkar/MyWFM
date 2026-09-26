import { Badge } from "./ui/Badge";
import { Card, CardBody } from "./ui/Card";
import type { NavLeaf } from "@/lib/nav/navTree";

/**
 * The only page shown for a nav leaf that has not been built yet. Deliberately
 * not a fake dashboard with placeholder numbers (build spec section 78/79) -
 * it names the real module description and the real phase it will land in,
 * sourced from the same navTree.ts the sidebar renders from.
 */
export function ComingSoon({ leaf }: { leaf: NavLeaf }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
          <Badge tone="info">Phase {leaf.phase}</Badge>
          <h1 className="text-lg font-semibold text-ink">{leaf.label}</h1>
          <p className="text-sm leading-relaxed text-ink-muted">{leaf.description}</p>
          <p className="text-xs text-ink-faint">
            Not yet implemented. This module is scheduled for Phase {leaf.phase} of the Universal MyWFM build - see the
            phase tracker in the root README.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
