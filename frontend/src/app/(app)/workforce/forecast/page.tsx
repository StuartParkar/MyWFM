"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface ForecastRow {
  businessDate: string;
  queueId: number;
  queueName: string | null;
  baseForecast: number | null;
  trendFactor: number | null;
  seasonalityFactor: number | null;
  holidayFactor: number;
  forecastedCalls: number | null;
  actualOfferedCalls: number | null;
  historyDaysUsed: number;
}

interface ForecastAccuracy {
  queueId: number | null;
  daysEvaluated: number;
  mae: number | null;
  mape: number | null;
  bias: number | null;
}

interface QueueLookup {
  id: number;
  code: string;
  name: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

export default function ForecastPage() {
  const { authFetch } = useAuth();
  const [range, setRange] = useState(defaultRange);
  const [queueId, setQueueId] = useState("");

  const queuesFetcher = useCallback(async (): Promise<AsyncResult<QueueLookup[]>> => {
    try {
      const res = await authFetch("/api/master-data/queues");
      const body = (await res.json()) as ApiResponse<QueueLookup[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: queues } = useAsyncResource(queuesFetcher);

  const fetcher = useCallback(async (): Promise<AsyncResult<ForecastRow[]>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (queueId) params.set("queueId", queueId);
      const res = await authFetch(`/api/forecast?${params}`);
      const body = (await res.json()) as ApiResponse<ForecastRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, queueId]);
  const { data: rows, error, loading, reload } = useAsyncResource(fetcher, [range, queueId]);

  const accuracyFetcher = useCallback(async (): Promise<AsyncResult<ForecastAccuracy>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (queueId) params.set("queueId", queueId);
      const res = await authFetch(`/api/forecast/accuracy?${params}`);
      const body = (await res.json()) as ApiResponse<ForecastAccuracy>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, queueId]);
  const { data: accuracy } = useAsyncResource(accuracyFetcher, [range, queueId]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Forecast</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Deterministic call-volume forecast (build spec section 21): Base Forecast x Trend Factor x Seasonality
          Factor x Holiday Factor, derived entirely from real historical Offered Calls per queue - no AI, no invented
          numbers. A date shows &ldquo;insufficient history&rdquo; rather than a guess when there isn&rsquo;t enough
          real call history behind it yet (see documentation/formulas.md).
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">From</span>
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">To</span>
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Queue</span>
          <select value={queueId} onChange={(e) => setQueueId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All queues</option>
            {queues?.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      {accuracy && accuracy.daysEvaluated > 0 && (
        <Card>
          <CardHeader title="Forecast accuracy" subtitle={`Over ${accuracy.daysEvaluated} day(s) in range where both a forecast and a real actual exist.`} />
          <CardBody className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">MAE</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{accuracy.mae}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">MAPE</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{accuracy.mape != null ? `${accuracy.mape}%` : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Bias</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{accuracy.bias == null ? "—" : accuracy.bias > 0 ? `+${accuracy.bias}` : accuracy.bias}</p>
            </div>
          </CardBody>
        </Card>
      )}

      {loading && <LoadingState label="Loading forecast" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && rows?.length === 0 && (
        <EmptyState title="No queue has any call history yet" description="Upload a phone-system export from Import Center, then come back - the forecast is built entirely from real Offered Calls." />
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Queue</th>
                <th className="px-4 py-3 font-medium">Base</th>
                <th className="px-4 py-3 font-medium">Trend</th>
                <th className="px-4 py-3 font-medium">Seasonality</th>
                <th className="px-4 py-3 font-medium">Holiday</th>
                <th className="px-4 py-3 font-medium">Forecast</th>
                <th className="px-4 py-3 font-medium">Actual</th>
                <th className="px-4 py-3 font-medium">History (days)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.businessDate}|${r.queueId}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">{r.businessDate}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.queueName ?? `Queue #${r.queueId}`}</td>
                  {r.forecastedCalls === null ? (
                    <td className="px-4 py-3 text-ink-faint" colSpan={5}>
                      <Badge tone="neutral">Insufficient history</Badge>
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{r.baseForecast}</td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{r.trendFactor}x</td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{r.seasonalityFactor}x</td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{r.holidayFactor}x</td>
                      <td className="px-4 py-3 text-ink font-medium tabular-nums">{r.forecastedCalls}</td>
                    </>
                  )}
                  <td className="px-4 py-3 text-ink tabular-nums">{r.actualOfferedCalls ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-faint tabular-nums">{r.historyDaysUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
