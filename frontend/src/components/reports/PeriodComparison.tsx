"use client";

import { Input } from "@/components/ui/Input";

export interface DateRange {
  from: string;
  to: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Period B defaults to the same length immediately before Period A, so a fresh report already
 * shows a meaningful week-over-week-style comparison rather than two identical empty pickers. */
export function defaultPeriods(): { periodA: DateRange; periodB: DateRange } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  const periodA = { from: toIsoDate(from), to: toIsoDate(to) };
  const priorTo = new Date(from);
  priorTo.setDate(priorTo.getDate() - 1);
  const priorFrom = new Date(priorTo);
  priorFrom.setDate(priorFrom.getDate() - 6);
  const periodB = { from: toIsoDate(priorFrom), to: toIsoDate(priorTo) };
  return { periodA, periodB };
}

export function PeriodRangePicker({ label, range, onChange }: { label: string; range: DateRange; onChange: (range: DateRange) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        <Input type="date" value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })} />
        <span className="text-ink-faint">→</span>
        <Input type="date" value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </div>
    </div>
  );
}

/** Positive-is-good by default (more coverage, more answered calls, ...) - pass
 * lowerIsBetter for metrics where a smaller number is the improvement (Shrinkage %, Abandon
 * Rate %, Staffing Gap's magnitude, ...). Neither color implies the change was intentional -
 * it's a plain direction indicator, not a judgement the page asserts on the user's behalf. */
export function formatDelta(a: number | null, b: number | null, opts?: { suffix?: string; lowerIsBetter?: boolean }): { text: string; tone: "success" | "critical" | "neutral" } {
  if (a === null || b === null) return { text: "—", tone: "neutral" };
  const delta = a - b;
  const suffix = opts?.suffix ?? "";
  if (delta === 0) return { text: `0${suffix}`, tone: "neutral" };
  const text = `${delta > 0 ? "+" : ""}${Math.round(delta * 100) / 100}${suffix}`;
  const better = opts?.lowerIsBetter ? delta < 0 : delta > 0;
  return { text, tone: better ? "success" : "critical" };
}
