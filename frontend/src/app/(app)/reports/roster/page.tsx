"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { defaultPeriods, formatDelta, PeriodRangePicker, type DateRange } from "@/components/reports/PeriodComparison";

interface ControlTowerSummary {
  plannedHC: { value: number | null };
  requiredHC: { value: number | null };
  coveragePct: { value: number | null };
}

interface RosterChange {
  businessDate: string;
}

interface RosterMetrics {
  plannedHC: number | null;
  requiredHC: number | null;
  coveragePct: number | null;
  changeCount: number;
  changeCountPartial: boolean;
}

const PAGE_CAP = 200;

function useRosterMetrics(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<RosterMetrics>> => {
    try {
      const [summaryRes, changesRes] = await Promise.all([
        authFetch(`/api/control-tower/summary?from=${range.from}&to=${range.to}`),
        authFetch(`/api/roster/changes?page=1&pageSize=${PAGE_CAP}`),
      ]);
      const summaryBody = (await summaryRes.json()) as ApiResponse<ControlTowerSummary>;
      const changesBody = (await changesRes.json()) as ApiResponse<PaginatedResult<RosterChange>>;
      if (!summaryRes.ok || !summaryBody.success) return { ok: false, message: !summaryBody.success ? summaryBody.error.message : `Request failed (${summaryRes.status})` };
      if (!changesRes.ok || !changesBody.success) return { ok: false, message: !changesBody.success ? changesBody.error.message : `Request failed (${changesRes.status})` };

      const inRange = changesBody.data.items.filter((c) => c.businessDate >= range.from && c.businessDate <= range.to);
      return {
        ok: true,
        data: {
          plannedHC: summaryBody.data.plannedHC.value,
          requiredHC: summaryBody.data.requiredHC.value,
          coveragePct: summaryBody.data.coveragePct.value,
          changeCount: inRange.length,
          changeCountPartial: changesBody.data.totalItems > PAGE_CAP,
        },
      };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function RosterReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useRosterMetrics(periodA);
  const b = useRosterMetrics(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;
  const partial = (a.data?.changeCountPartial ?? false) || (b.data?.changeCountPartial ?? false);

  const rows: { label: string; a: number | null; b: number | null; suffix?: string }[] = a.data && b.data
    ? [
        { label: "Planned HC (Scheduled)", a: a.data.plannedHC, b: b.data.plannedHC },
        { label: "Required HC", a: a.data.requiredHC, b: b.data.requiredHC },
        { label: "Coverage %", a: a.data.coveragePct, b: b.data.coveragePct, suffix: "%" },
        { label: "Confirmed Roster Changes", a: a.data.changeCount, b: b.data.changeCount },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Roster Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Requirement vs. published (Coverage %) and confirmed roster changes as this system&rsquo;s version history
          (every `roster.RosterChange` row is a full before/after audit entry - see documentation/roster.md),
          company-wide, Period A vs. Period B.
        </p>
      </div>

      <Card className="flex flex-wrap gap-6 px-5 py-4">
        <PeriodRangePicker label="Period A" range={periodA} onChange={setPeriodA} />
        <PeriodRangePicker label="Period B" range={periodB} onChange={setPeriodB} />
      </Card>

      {partial && (
        <p className="text-sm text-warning">
          More than {PAGE_CAP} roster changes exist company-wide - the change count above only scans the {PAGE_CAP} most recent.
        </p>
      )}

      {loading && <LoadingState label="Loading report" />}
      {!loading && error && <ErrorState message={error} onRetry={() => { a.reload(); b.reload(); }} />}
      {!loading && !error && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Metric</th>
                <th className="px-4 py-3 font-medium">Period A</th>
                <th className="px-4 py-3 font-medium">Period B</th>
                <th className="px-4 py-3 font-medium">Δ (A − B)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const delta = formatDelta(r.a, r.b, { suffix: r.suffix });
                return (
                  <tr key={r.label} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{r.label}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.a ?? "—"}{r.suffix ?? ""}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{r.b ?? "—"}{r.suffix ?? ""}</td>
                    <td className="px-4 py-3"><Badge tone={delta.tone}>{delta.text}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
