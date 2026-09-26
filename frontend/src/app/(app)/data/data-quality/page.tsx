"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface DataQualityIssueListItem {
  id: number;
  importRunId: number;
  importCode: string;
  severity: string;
  issueType: string;
  recordReference: string | null;
  description: string;
  suggestedAction: string | null;
  status: string;
  createdAt: string;
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  CRITICAL: "critical",
  HIGH: "critical",
  MEDIUM: "warning",
  LOW: "info",
};

const STATUS_FILTERS = ["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"] as const;

export default function DataQualityPage() {
  const { authFetch } = useAuth();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("OPEN");

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<DataQualityIssueListItem>>> => {
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await authFetch(`/api/imports/data-quality?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<DataQualityIssueListItem>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, statusFilter]);

  const { data: result, error, loading, reload } = useAsyncResource(fetcher, [statusFilter]);

  async function setIssueStatus(id: number, status: string) {
    await authFetch(`/api/imports/data-quality/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">Data Quality</h1>
          <p className="mt-1 text-sm text-ink-muted">Every anomaly an import finds, by severity, with a suggested corrective path.</p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number])}
          className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : s}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingState label="Loading data quality issues" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="No issues here" description="Nothing matches this filter - try a different status, or run an import to generate real findings." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Issue</th>
                <th className="px-4 py-3 font-medium">Record</th>
                <th className="px-4 py-3 font-medium">Import</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {result.items.map((issue) => (
                <tr key={issue.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-3">
                    <Badge tone={SEVERITY_TONE[issue.severity] ?? "neutral"}>{issue.severity}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{issue.description}</div>
                    {issue.suggestedAction && <div className="mt-1 text-xs text-ink-faint">→ {issue.suggestedAction}</div>}
                    <div className="mt-1 text-xs text-ink-faint">{issue.issueType}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{issue.recordReference ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">{issue.importCode}</td>
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{issue.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {issue.status === "OPEN" && (
                      <div className="flex flex-col gap-1">
                        <Button variant="ghost" onClick={() => setIssueStatus(issue.id, "RESOLVED")}>
                          Resolve
                        </Button>
                        <Button variant="ghost" onClick={() => setIssueStatus(issue.id, "IGNORED")}>
                          Ignore
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
