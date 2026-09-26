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
  coveragePct: { value: number | null };
}

function useControlTowerSummary(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<ControlTowerSummary>> => {
    try {
      const res = await authFetch(`/api/control-tower/summary?from=${range.from}&to=${range.to}`);
      const body = (await res.json()) as ApiResponse<ControlTowerSummary>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function StaffingReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useControlTowerSummary(periodA);
  const b = useControlTowerSummary(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;

  const rows: { label: string; a: number | null; b: number | null; suffix?: string; lowerIsBetter?: boolean }[] = a.data && b.data
    ? [
        { label: "Planned HC", a: a.data.plannedHC.value, b: b.data.plannedHC.value },
        { label: "Required HC", a: a.data.requiredHC.value, b: b.data.requiredHC.value },
        { label: "Staffing Gap", a: a.data.staffingGap.value, b: b.data.staffingGap.value, lowerIsBetter: false },
        { label: "Coverage %", a: a.data.coveragePct.value, b: b.data.coveragePct.value, suffix: "%" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Staffing Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Staffing Gap and Coverage % (build spec section 19), company-wide, Period A vs. Period B. For the live
          per-requirement breakdown behind these totals, see <code>/workforce/staffing</code>.
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
                const delta = formatDelta(r.a, r.b, { suffix: r.suffix, lowerIsBetter: r.lowerIsBetter });
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
