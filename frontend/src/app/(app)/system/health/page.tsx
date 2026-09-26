"use client";

import { useCallback } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";

interface SystemHealthReport {
  status: "UP" | "DEGRADED" | "DOWN";
  uptimeSeconds: number;
  database: { status: "UP" | "DOWN"; latencyMs?: number; error?: string };
  backgroundJobs: { queued: number; running: number; failedLast24h: number } | null;
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
    </div>
  );
}
