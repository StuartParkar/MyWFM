"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { defaultPeriods, formatDelta, PeriodRangePicker, type DateRange } from "@/components/reports/PeriodComparison";

type ExceptionCategory = "STAFFING" | "SERVICE_LEVEL" | "ATTENDANCE" | "DATA_QUALITY";
type ExceptionStatus = "DETECTED" | "ACKNOWLEDGED" | "ACTION_TAKEN" | "RESOLVED";

interface ExceptionRow {
  category: ExceptionCategory;
  status: ExceptionStatus;
}

interface ExceptionMetrics {
  total: number;
  staffing: number;
  serviceLevel: number;
  attendance: number;
  dataQuality: number;
  resolved: number;
  stillOpen: number;
  resolutionRatePct: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function useExceptionMetrics(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<ExceptionMetrics>> => {
    try {
      const res = await authFetch(`/api/intraday/exceptions?from=${range.from}&to=${range.to}`);
      const body = (await res.json()) as ApiResponse<ExceptionRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };

      const rows = body.data;
      const resolved = rows.filter((r) => r.status === "RESOLVED").length;
      return {
        ok: true,
        data: {
          total: rows.length,
          staffing: rows.filter((r) => r.category === "STAFFING").length,
          serviceLevel: rows.filter((r) => r.category === "SERVICE_LEVEL").length,
          attendance: rows.filter((r) => r.category === "ATTENDANCE").length,
          dataQuality: rows.filter((r) => r.category === "DATA_QUALITY").length,
          resolved,
          stillOpen: rows.length - resolved,
          resolutionRatePct: rows.length > 0 ? round2((resolved / rows.length) * 100) : null,
        },
      };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function ExceptionsReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useExceptionMetrics(periodA);
  const b = useExceptionMetrics(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;

  const rows: { label: string; a: number | null; b: number | null; suffix?: string; lowerIsBetter?: boolean }[] = a.data && b.data
    ? [
        { label: "Total Exceptions", a: a.data.total, b: b.data.total, lowerIsBetter: true },
        { label: "Staffing", a: a.data.staffing, b: b.data.staffing, lowerIsBetter: true },
        { label: "Service Level", a: a.data.serviceLevel, b: b.data.serviceLevel, lowerIsBetter: true },
        { label: "Attendance", a: a.data.attendance, b: b.data.attendance, lowerIsBetter: true },
        { label: "Data Quality", a: a.data.dataQuality, b: b.data.dataQuality, lowerIsBetter: true },
        { label: "Still Open", a: a.data.stillOpen, b: b.data.stillOpen, lowerIsBetter: true },
        { label: "Resolution Rate", a: a.data.resolutionRatePct, b: b.data.resolutionRatePct, suffix: "%" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Exceptions Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Exception volume and resolution reporting across every category (build spec section 20), Period A vs.
          Period B, from real intraday.Exception rows - see documentation/intraday.md. Counts are by DetectedAt
          falling in the period, regardless of a row&rsquo;s current status.
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
                    <td className="px-4 py-3 text-ink tabular-nums">{r.a != null ? `${r.a}${r.suffix ?? ""}` : "—"}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{r.b != null ? `${r.b}${r.suffix ?? ""}` : "—"}</td>
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
