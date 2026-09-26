"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { defaultPeriods, formatDelta, PeriodRangePicker, type DateRange } from "@/components/reports/PeriodComparison";

interface DailySummary {
  netWorkingHours: number | null;
  varianceHours: number | null;
  lateMinutes: number | null;
  earlyLogoutMinutes: number | null;
  status: "PRESENT" | "ABSENT" | "ON_WEEKLY_OFF";
}

interface AttendanceMetrics {
  daysCounted: number;
  totalItems: number;
  avgNetWorkingHours: number | null;
  avgVarianceHours: number | null;
  absenceCount: number;
  lateCount: number;
  earlyLogoutCount: number;
}

const PAGE_CAP = 200;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function useAttendanceMetrics(range: DateRange) {
  const { authFetch } = useAuth();
  const fetcher = useCallback(async (): Promise<AsyncResult<AttendanceMetrics>> => {
    try {
      const res = await authFetch(`/api/attendance?from=${range.from}&to=${range.to}&page=1&pageSize=${PAGE_CAP}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<DailySummary>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };

      const rows = body.data.items;
      const scheduled = rows.filter((r) => r.status !== "ON_WEEKLY_OFF");
      const withNet = scheduled.filter((r) => r.netWorkingHours !== null);
      const withVariance = scheduled.filter((r) => r.varianceHours !== null);
      return {
        ok: true,
        data: {
          daysCounted: rows.length,
          totalItems: body.data.totalItems,
          avgNetWorkingHours: withNet.length > 0 ? round2(withNet.reduce((s, r) => s + r.netWorkingHours!, 0) / withNet.length) : null,
          avgVarianceHours: withVariance.length > 0 ? round2(withVariance.reduce((s, r) => s + r.varianceHours!, 0) / withVariance.length) : null,
          absenceCount: scheduled.filter((r) => r.status === "ABSENT").length,
          lateCount: rows.filter((r) => (r.lateMinutes ?? 0) > 0).length,
          earlyLogoutCount: rows.filter((r) => (r.earlyLogoutMinutes ?? 0) > 0).length,
        },
      };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range.from, range.to]);
  return useAsyncResource(fetcher, [range.from, range.to]);
}

export default function AttendanceReportPage() {
  const { periodA: initialA, periodB: initialB } = defaultPeriods();
  const [periodA, setPeriodA] = useState(initialA);
  const [periodB, setPeriodB] = useState(initialB);

  const a = useAttendanceMetrics(periodA);
  const b = useAttendanceMetrics(periodB);
  const loading = a.loading || b.loading;
  const error = a.error ?? b.error;
  const partial = (a.data && a.data.totalItems > PAGE_CAP) || (b.data && b.data.totalItems > PAGE_CAP);

  const rows: { label: string; a: number | null; b: number | null; lowerIsBetter?: boolean }[] = a.data && b.data
    ? [
        { label: "Avg Net Working Hours", a: a.data.avgNetWorkingHours, b: b.data.avgNetWorkingHours },
        { label: "Avg Variance (hrs)", a: a.data.avgVarianceHours, b: b.data.avgVarianceHours },
        { label: "Absences", a: a.data.absenceCount, b: b.data.absenceCount, lowerIsBetter: true },
        { label: "Late Logins", a: a.data.lateCount, b: b.data.lateCount, lowerIsBetter: true },
        { label: "Early Logouts", a: a.data.earlyLogoutCount, b: b.data.earlyLogoutCount, lowerIsBetter: true },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Attendance Report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Net working hours, variance and late/early/absence counts (build spec section 15), company-wide, Period A
          vs. Period B, from real recorded attendance sessions.
        </p>
      </div>

      <Card className="flex flex-wrap gap-6 px-5 py-4">
        <PeriodRangePicker label="Period A" range={periodA} onChange={setPeriodA} />
        <PeriodRangePicker label="Period B" range={periodB} onChange={setPeriodB} />
      </Card>

      {partial && (
        <p className="text-sm text-warning">
          One or both periods have more than {PAGE_CAP} employee/day records - this report covers only the first {PAGE_CAP} per period, not the full total.
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
