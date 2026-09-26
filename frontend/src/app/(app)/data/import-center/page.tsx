"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
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

const CALLS_SOURCES: { value: string; label: string }[] = [
  { value: "vonage-queuewise", label: "Vonage QueueWise" },
  { value: "vonage-company-summary", label: "Vonage - Company Summary" },
  { value: "elevate", label: "Elevate" },
  { value: "ringcentral-calls", label: "RingCentral (agent-wise Calls sheet)" },
];

export default function ImportCenterPage() {
  const { authFetch } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const callsFileInputRef = useRef<HTMLInputElement>(null);
  const [callsSource, setCallsSource] = useState(CALLS_SOURCES[0]!.value);
  const [callsUploading, setCallsUploading] = useState(false);
  const [callsUploadError, setCallsUploadError] = useState<string | null>(null);
  const [callsLastResult, setCallsLastResult] = useState<string | null>(null);

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

  async function handleCallsFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCallsUploading(true);
    setCallsUploadError(null);
    setCallsLastResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch(`/api/calls/import/${callsSource}`, { method: "POST", body: formData });
      const body = (await res.json()) as ApiResponse<{
        importCode: string;
        recordsAccepted: number;
        recordsRejected: number;
        queueRowsInserted: number;
        agentRowsInserted: number;
        dataQualityIssueCount: number;
      }>;
      if (!res.ok || !body.success) {
        setCallsUploadError(!body.success ? body.error.message : "Import failed.");
      } else {
        setCallsLastResult(
          `${body.data.importCode}: ${body.data.recordsAccepted} accepted, ${body.data.recordsRejected} rejected, ` +
            `${body.data.queueRowsInserted} queue-grain row(s), ${body.data.agentRowsInserted} agent-grain row(s), ` +
            `${body.data.dataQualityIssueCount} data quality issue(s) raised.`,
        );
        reload();
      }
    } catch {
      setCallsUploadError("Could not reach the backend.");
    } finally {
      setCallsUploading(false);
      if (callsFileInputRef.current) callsFileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Import Center</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload -&gt; staging -&gt; validation -&gt; normalization -&gt; duplicate check -&gt; data quality -&gt; merge (build spec
          section 29). Wired for two source types so far - the employee/organization hierarchy and the four real
          phone-system call exports - since those are the only real source files available so far; see
          documentation/imports.md and documentation/phone-system-mapping.md.
        </p>
      </div>

      <Card>
        <CardHeader title="Employee / Organization Hierarchy" subtitle="Tab-separated export - see imports/samples/master-data/README.md." />
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

      <Card>
        <CardHeader title="Calls" subtitle="Vonage, Elevate or RingCentral export (.xlsx) - see imports/samples/calls/README.md for the exact sheet each source expects." />
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Source</span>
              <select
                value={callsSource}
                onChange={(e) => setCallsSource(e.target.value)}
                disabled={callsUploading}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {CALLS_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Upload calls file</span>
              <input
                ref={callsFileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleCallsFileChange}
                disabled={callsUploading}
                className="text-sm text-ink"
              />
            </label>
            {callsUploading && <span className="text-sm text-ink-muted">Uploading…</span>}
          </div>
          {callsUploadError && <p className="text-sm text-critical">{callsUploadError}</p>}
          {callsLastResult && <p className="text-sm text-success">{callsLastResult}</p>}
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
