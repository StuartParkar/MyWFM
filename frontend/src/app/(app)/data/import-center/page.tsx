"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface ImportRunListItem {
  importRunId: number;
  importCode: string;
  sourceSystem: string;
  fileName: string;
  status: string;
  uploadedAt: string;
  recordsReceived: number | null;
  recordsAccepted: number | null;
  recordsRejected: number | null;
  durationMs: number | null;
  dataQualityIssueCount: number;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  STAGED: "neutral",
  VALIDATING: "info",
  NORMALIZING: "info",
  DUPLICATE_CHECK: "info",
  DATA_QUALITY: "info",
  MERGING: "info",
  COMPLETED: "success",
  FAILED: "critical",
};

export default function ImportCenterPage() {
  const { authFetch } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<ImportRunListItem>>> => {
    try {
      const res = await authFetch("/api/imports?pageSize=50");
      const body = (await res.json()) as ApiResponse<PaginatedResult<ImportRunListItem>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: result, error, loading, reload } = useAsyncResource(fetcher);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setLastResult(null);
    try {
      const text = await file.text();
      const res = await authFetch(`/api/imports/org-hierarchy?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: text,
      });
      const body = (await res.json()) as ApiResponse<{ importCode: string; recordsAccepted: number; recordsRejected: number; dataQualityIssueCount: number }>;
      if (!res.ok || !body.success) {
        setUploadError(!body.success ? body.error.message : "Import failed.");
      } else {
        setLastResult(
          `${body.data.importCode}: ${body.data.recordsAccepted} accepted, ${body.data.recordsRejected} rejected, ${body.data.dataQualityIssueCount} data quality issue(s) raised.`,
        );
        reload();
      }
    } catch {
      setUploadError("Could not reach the backend.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Import Center</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload -&gt; staging -&gt; validation -&gt; normalization -&gt; duplicate check -&gt; data quality -&gt; merge (build spec
          section 29). Currently wired for one source type - the employee/organization hierarchy - since that&rsquo;s the only
          real source file available so far; see documentation/imports.md.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <label>
              <span className="sr-only">Upload employee hierarchy file</span>
              <input ref={fileInputRef} type="file" accept=".tsv,.txt,.csv" onChange={handleFileChange} disabled={uploading} className="text-sm text-ink" />
            </label>
            {uploading && <span className="text-sm text-ink-muted">Uploading…</span>}
          </div>
          {uploadError && <p className="text-sm text-critical">{uploadError}</p>}
          {lastResult && <p className="text-sm text-success">{lastResult}</p>}
        </CardBody>
      </Card>

      {loading && <LoadingState label="Loading import runs" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="No imports yet" description="Upload the employee/organization hierarchy file above to see it run through the pipeline." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Import</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Received / Accepted / Rejected</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Data Quality</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((run) => (
                <tr key={run.importRunId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-ink">{run.importCode}</div>
                    <div className="text-xs text-ink-faint">{run.fileName}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{run.sourceSystem}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{run.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">
                    {run.recordsReceived ?? "—"} / {run.recordsAccepted ?? "—"} / {run.recordsRejected ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{run.durationMs != null ? `${run.durationMs} ms` : "—"}</td>
                  <td className="px-4 py-3">
                    {run.dataQualityIssueCount > 0 ? (
                      <Badge tone="warning">{run.dataQualityIssueCount} issue(s)</Badge>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Button variant="ghost" className="self-start" onClick={reload}>
        Refresh
      </Button>
    </div>
  );
}
