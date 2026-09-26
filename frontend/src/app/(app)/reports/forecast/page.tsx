"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { defaultPeriods, formatDelta, PeriodRangePicker, type DateRange } from "@/components/reports/PeriodComparison";

interface ForecastAccuracy {
  daysEvaluated: number;
  mae: number | null;
  mape: number | null;
  bias: number | null;
}

function useForecastAccuracy(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<ForecastAccuracy>> => {
    try {
      const res = await authFetch(`/api/forecast/accuracy?from=${range.from}&to=${range.to}`);
      const body = (await res.json()) as ApiResponse<ForecastAccuracy>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function ForecastReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useForecastAccuracy(periodA);
  const b = useForecastAccuracy(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;

  const rows: { label: string; a: number | null; b: number | null; lowerIsBetter?: boolean }[] = a.data && b.data
    ? [
        { label: "Days Evaluated", a: a.data.daysEvaluated, b: b.data.daysEvaluated },
        { label: "MAE", a: a.data.mae, b: b.data.mae, lowerIsBetter: true },
        { label: "MAPE %", a: a.data.mape, b: b.data.mape, lowerIsBetter: true },
        { label: "Bias", a: a.data.bias, b: b.data.bias },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Forecast Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Forecast accuracy - MAE, MAPE, Bias (build spec section 21) - comparing each day&rsquo;s forecast (built
          only from history strictly before it) against what really happened, Period A vs. Period B. Zero days
          evaluated means neither period yet has both a forecast and a real actual to compare - see
          <code> /workforce/forecast</code>.
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
                const delta = formatDelta(r.a, r.b, { lowerIsBetter: r.lowerIsBetter });
                return (
                  <tr key={r.label} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{r.label}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.a ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{r.b ?? "—"}</td>
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
