"use client";

import { useCallback } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface SystemHealthReport {
  status: "UP" | "DEGRADED" | "DOWN";
  uptimeSeconds: number;
  database: { status: "UP" | "DOWN"; latencyMs?: number; error?: string };
  backgroundJobs: { queued: number; running: number; failedLast24h: number } | null;
}

interface HealthSnapshot {
  snapshotId: number;
  capturedAt: string;
  status: "UP" | "DEGRADED" | "DOWN";
  databaseStatus: "UP" | "DOWN";
  databaseLatencyMs: number | null;
  jobsQueued: number;
  jobsRunning: number;
  jobsFailedLast24h: number;
}

export default function SystemHealthPage() {
  const { authFetch } = useAuth();

  const fetcher = useCallback(async (): Promise<AsyncResult<SystemHealthReport>> => {
    try {
      const res = await authFetch("/api/system-health/detail");
      const body = (await res.json()) as ApiResponse<SystemHealthReport>;
      if (!res.ok || !body.success) {
        return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      }
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: report, error, loading, reload } = useAsyncResource(fetcher);

  const historyFetcher = useCallback(async (): Promise<AsyncResult<HealthSnapshot[]>> => {
    try {
      const res = await authFetch("/api/system-health/history");
      const body = (await res.json()) as ApiResponse<HealthSnapshot[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: history, error: historyError, loading: historyLoading } = useAsyncResource(historyFetcher);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-ink">System Health</h1>

      {loading && <LoadingState label="Loading system health" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader
              title="SQL Server"
              action={<Badge tone={report.database.status === "UP" ? "success" : "critical"}>{report.database.status}</Badge>}
            />
            <CardBody>
              {report.database.status === "UP" ? (
                <p className="text-sm text-ink-muted">Round-trip latency: {report.database.latencyMs} ms</p>
              ) : (
                <p className="text-sm text-ink-muted">{report.database.error}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Background Jobs" />
            <CardBody>
              {report.backgroundJobs ? (
                <dl className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <dt className="text-xs text-ink-faint">Queued</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink">{report.backgroundJobs.queued}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Running</dt>
                    <dd className="text-lg font-semibold tabular-nums text-ink">{report.backgroundJobs.running}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-faint">Failed (24h)</dt>
                    <dd className="text-lg font-semibold tabular-nums text-critical">{report.backgroundJobs.failedLast24h}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-ink-muted">Unavailable while the database is down.</p>
              )}
            </CardBody>
          </Card>

          <Card className="sm:col-span-2">
            <CardHeader title="Process" />
            <CardBody>
              <p className="text-sm text-ink-muted">Uptime: {Math.floor(report.uptimeSeconds / 60)} min {report.uptimeSeconds % 60}s</p>
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="History" subtitle="Sampled periodically in the background (system.health_snapshot_interval_minutes) - not another live check." />
        {historyLoading && <LoadingState label="Loading history" />}
        {!historyLoading && historyError && <ErrorState message={historyError} />}
        {!historyLoading && !historyError && history?.length === 0 && (
          <EmptyState title="No history yet" description="The first sample is captured shortly after the backend starts - check back in a few minutes." />
        )}
        {!historyLoading && !historyError && history && history.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Captured At</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">DB Latency</th>
                  <th className="px-4 py-3 font-medium">Queued</th>
                  <th className="px-4 py-3 font-medium">Running</th>
                  <th className="px-4 py-3 font-medium">Failed (24h)</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.snapshotId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink-muted">{new Date(s.capturedAt).toLocaleString()}</td>
                    <td className="px-4 py-3"><Badge tone={s.status === "UP" ? "success" : s.status === "DEGRADED" ? "warning" : "critical"}>{s.status}</Badge></td>
                    <td className="px-4 py-3 text-ink tabular-nums">{s.databaseLatencyMs != null ? `${s.databaseLatencyMs} ms` : "—"}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{s.jobsQueued}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{s.jobsRunning}</td>
                    <td className="px-4 py-3 tabular-nums text-critical">{s.jobsFailedLast24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
