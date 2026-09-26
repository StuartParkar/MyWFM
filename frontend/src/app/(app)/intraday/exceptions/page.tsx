"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

type ExceptionStatus = "DETECTED" | "ACKNOWLEDGED" | "ACTION_TAKEN" | "RESOLVED";
type ExceptionCategory = "STAFFING" | "SERVICE_LEVEL" | "ATTENDANCE" | "DATA_QUALITY";

interface ExceptionRow {
  exceptionId: number;
  ruleCode: string;
  category: ExceptionCategory;
  ruleDescription: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  intervalStart: string;
  observedValue: number;
  thresholdValue: number;
  status: ExceptionStatus;
  detectedAt: string;
}

interface ProcessLookup {
  id: number;
  code: string;
  name: string;
}

const STATUS_TONE: Record<ExceptionStatus, BadgeTone> = { DETECTED: "critical", ACKNOWLEDGED: "warning", ACTION_TAKEN: "info", RESOLVED: "success" };

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

export default function ExceptionsPage() {
  const { authFetch } = useAuth();
  const [range, setRange] = useState(defaultRange);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  const [scanBusinessDate, setScanBusinessDate] = useState(() => toIsoDate(new Date()));
  const [scanProcessId, setScanProcessId] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const processesFetcher = useCallback(async (): Promise<AsyncResult<ProcessLookup[]>> => {
    try {
      const res = await authFetch("/api/master-data/processes");
      const body = (await res.json()) as ApiResponse<ProcessLookup[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: processes } = useAsyncResource(processesFetcher);

  const fetcher = useCallback(async (): Promise<AsyncResult<ExceptionRow[]>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      const res = await authFetch(`/api/intraday/exceptions?${params}`);
      const body = (await res.json()) as ApiResponse<ExceptionRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, category, status]);
  const { data: rows, error, loading, reload } = useAsyncResource(fetcher, [range, category, status]);

  async function runScan(e: React.FormEvent) {
    e.preventDefault();
    setScanError(null);
    setScanMessage(null);
    setScanBusy(true);
    const res = await authFetch("/api/intraday/exceptions/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessDate: scanBusinessDate, processId: scanProcessId ? Number(scanProcessId) : undefined }),
    });
    setScanBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setScanError(!body.success ? body.error.message : "Could not run the scan.");
      return;
    }
    const body = (await res.json()) as ApiResponse<{ newExceptionCount: number }>;
    if (body.success) {
      setScanMessage(body.data.newExceptionCount > 0 ? `Found ${body.data.newExceptionCount} new exception(s).` : "No new exceptions found - everything already tracked is still open, or nothing breaches a rule right now.");
      reload();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Exceptions</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The configurable-threshold exception engine across staffing, service level, attendance and data quality
          (build spec section 20) - every row here is a real breach of a real rule (Admin-adjustable thresholds,
          see documentation/intraday.md), never a guess. Detection runs on demand via the scan below, not on a
          schedule.
        </p>
      </div>

      <Card>
        <CardHeader title="Scan for exceptions" subtitle="Evaluates every active rule against real data for the chosen business date/process. Data Quality rules ignore this date filter - see documentation/intraday.md." />
        <CardBody>
          <form onSubmit={runScan} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Business date</span>
              <input type="date" value={scanBusinessDate} onChange={(e) => setScanBusinessDate(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Process</span>
              <select value={scanProcessId} onChange={(e) => setScanProcessId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                <option value="">All processes</option>
                {processes?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={scanBusy}>
              {scanBusy ? "Scanning..." : "Scan for exceptions"}
            </Button>
          </form>
          {scanMessage && <p className="mt-2 text-sm text-success">{scanMessage}</p>}
          {scanError && <p className="mt-2 text-sm text-critical">{scanError}</p>}
        </CardBody>
      </Card>

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
          <span className="text-xs font-medium text-ink-muted">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All categories</option>
            <option value="STAFFING">Staffing</option>
            <option value="SERVICE_LEVEL">Service Level</option>
            <option value="ATTENDANCE">Attendance</option>
            <option value="DATA_QUALITY">Data Quality</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All statuses</option>
            <option value="DETECTED">Detected</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="ACTION_TAKEN">Action taken</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
      </Card>

      {loading && <LoadingState label="Loading exceptions" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && rows?.length === 0 && <EmptyState title="No exceptions in range" description="Run a scan above, or widen the date range/filters." />}
      {!loading && !error && rows && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Business Date</th>
                <th className="px-4 py-3 font-medium">Observed</th>
                <th className="px-4 py-3 font-medium">Threshold</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Detected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.exceptionId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">
                    <div className="font-medium">{r.ruleCode}</div>
                    <div className="text-xs text-ink-faint">{r.ruleDescription}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.entityType} #{r.entityId}
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{r.businessDate}</td>
                  <td className="px-4 py-3 text-ink tabular-nums">{r.observedValue}</td>
                  <td className="px-4 py-3 text-ink-faint tabular-nums">{r.thresholdValue}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-faint tabular-nums">{new Date(r.detectedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
