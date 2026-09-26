"use client";

import { useCallback } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface JobRow {
  JobId: number;
  JobType: string;
  Status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  Attempts: number;
  MaxAttempts: number;
  ErrorMessage: string | null;
  CreatedAt: string;
  StartedAt: string | null;
  CompletedAt: string | null;
}

const STATUS_TONE: Record<JobRow["Status"], BadgeTone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "critical",
  CANCELLED: "warning",
};

export default function JobsPage() {
  const { authFetch } = useAuth();

  const fetcher = useCallback(async (): Promise<AsyncResult<JobRow[]>> => {
    try {
      const res = await authFetch("/api/jobs?limit=50");
      const body = (await res.json()) as ApiResponse<JobRow[]>;
      if (!res.ok || !body.success) {
        return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      }
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: jobs, error, loading, reload } = useAsyncResource(fetcher);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-ink">Background Jobs</h1>

      {loading && <LoadingState label="Loading jobs" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && jobs?.length === 0 && (
        <EmptyState title="No jobs yet" description="Jobs are enqueued by long-running work such as imports, calculations and exports (Phase 3+)." />
      )}

      {!loading && !error && jobs && jobs.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.JobId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink-muted">#{job.JobId}</td>
                  <td className="px-4 py-3 text-ink">{job.JobType}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[job.Status]}>{job.Status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {job.Attempts}/{job.MaxAttempts}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{new Date(job.CreatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
