"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { defaultPeriods, formatDelta, PeriodRangePicker, type DateRange } from "@/components/reports/PeriodComparison";

interface ControlTowerSummary {
  plannedHC: { value: number | null };
  requiredHC: { value: number | null };
  staffingGap: { value: number | null };
}

interface CapacityRow {
  workloadHours: number;
  capacityHours: number;
  requiredProductiveHC: number | null;
}

interface WorkforceMetrics {
  plannedHC: number | null;
  requiredHC: number | null;
  staffingGap: number | null;
  capacityHours: number;
  capacityUtilizationPct: number | null;
  avgRequiredProductiveHC: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function useWorkforceMetrics(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<WorkforceMetrics>> => {
    try {
      const [summaryRes, capacityRes] = await Promise.all([
        authFetch(`/api/control-tower/summary?from=${range.from}&to=${range.to}`),
        authFetch(`/api/staffing/capacity?from=${range.from}&to=${range.to}`),
      ]);
      const summaryBody = (await summaryRes.json()) as ApiResponse<ControlTowerSummary>;
      const capacityBody = (await capacityRes.json()) as ApiResponse<CapacityRow[]>;
      if (!summaryRes.ok || !summaryBody.success) return { ok: false, message: !summaryBody.success ? summaryBody.error.message : `Request failed (${summaryRes.status})` };
      if (!capacityRes.ok || !capacityBody.success) return { ok: false, message: !capacityBody.success ? capacityBody.error.message : `Request failed (${capacityRes.status})` };

      const capacityRows = capacityBody.data;
      const workloadHours = round2(capacityRows.reduce((sum, r) => sum + r.workloadHours, 0));
      const capacityHours = round2(capacityRows.reduce((sum, r) => sum + r.capacityHours, 0));
      const withRequired = capacityRows.filter((r) => r.requiredProductiveHC !== null);
      const avgRequiredProductiveHC = withRequired.length > 0 ? round2(withRequired.reduce((sum, r) => sum + r.requiredProductiveHC!, 0) / withRequired.length) : null;

      return {
        ok: true,
        data: {
          plannedHC: summaryBody.data.plannedHC.value,
          requiredHC: summaryBody.data.requiredHC.value,
          staffingGap: summaryBody.data.staffingGap.value,
          capacityHours,
          capacityUtilizationPct: capacityHours > 0 ? round2((workloadHours / capacityHours) * 100) : null,
          avgRequiredProductiveHC,
        },
      };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function WorkforceReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useWorkforceMetrics(periodA);
  const b = useWorkforceMetrics(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;

  const rows: { label: string; a: number | null; b: number | null; suffix?: string }[] = a.data && b.data
    ? [
        { label: "Planned HC", a: a.data.plannedHC, b: b.data.plannedHC },
        { label: "Required HC", a: a.data.requiredHC, b: b.data.requiredHC },
        { label: "Staffing Gap", a: a.data.staffingGap, b: b.data.staffingGap },
        { label: "Capacity (agent-hrs, summed)", a: a.data.capacityHours, b: b.data.capacityHours },
        { label: "Capacity Utilization %", a: a.data.capacityUtilizationPct, b: b.data.capacityUtilizationPct, suffix: "%" },
        { label: "Avg Required Productive HC/day", a: a.data.avgRequiredProductiveHC, b: b.data.avgRequiredProductiveHC },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Workforce Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          HC, Required HC, Staffing Gap, Capacity and Capacity Utilization (build spec section 19), company-wide,
          Period A vs. Period B. Capacity Utilization is recomputed from each period&rsquo;s *summed* Workload/Capacity
          hours, never by averaging daily percentages; Required Productive HC is a per-day snapshot, so its figure
          here is an average across the period&rsquo;s days, not a sum.
        </p>
      </div>

      <Card className="flex flex-wrap gap-6 px-5 py-4">
        <PeriodRangePicker label="Period A" range={periodA} onChange={setPeriodA} />
        <PeriodRangePicker label="Period B" range={periodB} onChange={setPeriodB} />
      </Card>

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
