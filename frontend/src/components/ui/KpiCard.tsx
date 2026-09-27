import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardBody } from "./Card";
import { Badge, type BadgeTone } from "./Badge";
import { cn } from "@/lib/cn";

export interface KpiTrend {
  direction: "up" | "down";
  label: string;
  /** Tone for the trend chip. Direction alone doesn't imply good/bad (a rising abandon rate is bad). */
  tone: BadgeTone;
}

export function KpiCard({
  label,
  value,
  tone,
  hint,
  icon: Icon,
  trend,
  className,
}: {
  label: string;
  value: string;
  tone?: BadgeTone;
  hint?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  trend?: KpiTrend;
  className?: string;
}) {
  return (
    <Card interactive className={cn("group", className)}>
      <CardBody>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
          {Icon && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] group-hover:scale-110">
              <Icon size={14} />
            </span>
          )}
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold text-ink tabular-nums">{value}</span>
          {tone && hint && <Badge tone={tone}>{hint}</Badge>}
        </div>
        {!tone && hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
        {trend && (
          <p
            className={cn(
              "mt-2 flex items-center gap-1 text-xs font-medium",
              trend.tone === "success" && "text-success",
              trend.tone === "warning" && "text-warning",
              trend.tone === "critical" && "text-critical",
              trend.tone === "info" && "text-info",
              trend.tone === "neutral" && "text-ink-muted",
            )}
          >
            {trend.direction === "up" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trend.label}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
