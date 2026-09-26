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
  ahtSeconds: { value: number | null };
  serviceLevelPct: { value: number | null };
  abandonRatePct: { value: number | null };
  occupancyPct: { value: number | null };
}

interface ProcessCallMetrics {
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
}

interface CallsMetrics {
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  ahtSeconds: number | null;
  serviceLevelPct: number | null;
  abandonRatePct: number | null;
  occupancyPct: number | null;
}

function useCallsMetrics(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<CallsMetrics>> => {
    try {
      const [summaryRes, metricsRes] = await Promise.all([
        authFetch(`/api/control-tower/summary?from=${range.from}&to=${range.to}`),
        authFetch(`/api/calls/metrics/by-process?from=${range.from}&to=${range.to}`),
      ]);
      const summaryBody = (await summaryRes.json()) as ApiResponse<ControlTowerSummary>;
      const metricsBody = (await metricsRes.json()) as ApiResponse<ProcessCallMetrics[]>;
      if (!summaryRes.ok || !summaryBody.success) return { ok: false, message: !summaryBody.success ? summaryBody.error.message : `Request failed (${summaryRes.status})` };
      if (!metricsRes.ok || !metricsBody.success) return { ok: false, message: !metricsBody.success ? metricsBody.error.message : `Request failed (${metricsRes.status})` };

      const rows = metricsBody.data;
      return {
        ok: true,
        data: {
          offeredCalls: rows.reduce((sum, r) => sum + r.offeredCalls, 0),
          answeredCalls: rows.reduce((sum, r) => sum + r.answeredCalls, 0),
          abandonedCalls: rows.reduce((sum, r) => sum + r.abandonedCalls, 0),
          ahtSeconds: summaryBody.data.ahtSeconds.value,
          serviceLevelPct: summaryBody.data.serviceLevelPct.value,
          abandonRatePct: summaryBody.data.abandonRatePct.value,
          occupancyPct: summaryBody.data.occupancyPct.value,
        },
      };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function CallsReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useCallsMetrics(periodA);
  const b = useCallsMetrics(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;

  const rows: { label: string; a: number | null; b: number | null; suffix?: string; lowerIsBetter?: boolean }[] = a.data && b.data
    ? [
        { label: "Offered Calls", a: a.data.offeredCalls, b: b.data.offeredCalls },
        { label: "Answered Calls", a: a.data.answeredCalls, b: b.data.answeredCalls },
        { label: "Abandoned Calls", a: a.data.abandonedCalls, b: b.data.abandonedCalls, lowerIsBetter: true },
        { label: "AHT (seconds)", a: a.data.ahtSeconds, b: b.data.ahtSeconds, lowerIsBetter: true },
        { label: "Service Level %", a: a.data.serviceLevelPct, b: b.data.serviceLevelPct, suffix: "%" },
        { label: "Abandon Rate %", a: a.data.abandonRatePct, b: b.data.abandonRatePct, suffix: "%", lowerIsBetter: true },
        { label: "Occupancy %", a: a.data.occupancyPct, b: b.data.occupancyPct, suffix: "%" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Calls Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Offered/Answered/Abandoned/AHT/Service Level/Occupancy (build spec sections 17-18), company-wide, Period A
          vs. Period B - process-scoped only, see documentation/controltower.md for why the HOD/TL/Agent-Senior
          cascade doesn&rsquo;t apply to queue-level call facts.
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
