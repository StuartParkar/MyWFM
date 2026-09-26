import { Card, CardBody } from "./Card";
import { Badge, type BadgeTone } from "./Badge";

export function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: BadgeTone;
  hint?: string;
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold text-ink tabular-nums">{value}</span>
          {tone && hint && <Badge tone={tone}>{hint}</Badge>}
        </div>
        {!tone && hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      </CardBody>
    </Card>
  );
}
