"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

type CalculationType = "SHRINKAGE" | "STAFFING_COVERAGE" | "STAFFING_CAPACITY" | "CALLS_BY_QUEUE" | "CALLS_BY_PROCESS" | "FORECAST" | "ATTRITION";

const CALCULATION_TYPES: { value: CalculationType; label: string; dimension: "none" | "department+process" | "process" | "queue" | "attrition" }[] = [
  { value: "SHRINKAGE", label: "Shrinkage %", dimension: "none" },
  { value: "STAFFING_COVERAGE", label: "Staffing: Roster Coverage % / Staffing Gap", dimension: "department+process" },
  { value: "STAFFING_CAPACITY", label: "Staffing: Capacity / Required Productive HC / Occupancy", dimension: "process" },
  { value: "CALLS_BY_QUEUE", label: "Calls (by queue): Answer Rate / AHT / Service Level", dimension: "queue" },
  { value: "CALLS_BY_PROCESS", label: "Calls (by process, roll-up)", dimension: "process" },
  { value: "FORECAST", label: "Forecast", dimension: "queue" },
  { value: "ATTRITION", label: "Attrition Rate", dimension: "attrition" },
];

interface IdNameRow {
  id: number;
  name: string;
}

interface ReprocessingRequestRow {
  requestId: number;
  calculationType: string;
  fromDate: string;
  toDate: string;
  scope: Record<string, unknown> | null;
  reason: string;
  requestedByName: string | null;
  requestedAt: string;
  status: string;
  resultSummary: { itemsRecomputed: number } | null;
  errorMessage: string | null;
}

async function fetchLookup(authFetch: (path: string) => Promise<Response>, path: string): Promise<AsyncResult<IdNameRow[]>> {
  try {
    const res = await authFetch(path);
    const body = (await res.json()) as ApiResponse<IdNameRow[]>;
    if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, message: "Could not reach the backend." };
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function scopeSummary(scope: Record<string, unknown> | null): string {
  if (!scope) return "—";
  const parts = Object.entries(scope).filter(([, v]) => v !== null && v !== undefined);
  return parts.length === 0 ? "All" : parts.map(([k, v]) => `${k}: ${v}`).join(", ");
}

export default function ReprocessingPage() {
  const { authFetch } = useAuth();
  const [calculationType, setCalculationType] = useState<CalculationType>("SHRINKAGE");
  const [from, setFrom] = useState(() => toIsoDate(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(() => toIsoDate(new Date()));
  const [departmentId, setDepartmentId] = useState("");
  const [processId, setProcessId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [queueId, setQueueId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const departmentsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/departments"), [authFetch]);
  const processesFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/processes"), [authFetch]);
  const locationsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/locations"), [authFetch]);
  const designationsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/designations"), [authFetch]);
  const queuesFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/queues"), [authFetch]);
  const { data: departments } = useAsyncResource(departmentsFetcher);
  const { data: processes } = useAsyncResource(processesFetcher);
  const { data: locations } = useAsyncResource(locationsFetcher);
  const { data: designations } = useAsyncResource(designationsFetcher);
  const { data: queues } = useAsyncResource(queuesFetcher);

  const historyFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<ReprocessingRequestRow>>> => {
    try {
      const res = await authFetch("/api/reprocessing?page=1&pageSize=50");
      const body = (await res.json()) as ApiResponse<PaginatedResult<ReprocessingRequestRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: history, error: historyError, loading: historyLoading, reload: reloadHistory } = useAsyncResource(historyFetcher);

  const activeType = CALCULATION_TYPES.find((t) => t.value === calculationType)!;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    const body: Record<string, unknown> = { calculationType, from, to, reason };
    if (activeType.dimension === "department+process") {
      if (departmentId) body.departmentId = Number(departmentId);
      if (processId) body.processId = Number(processId);
    } else if (activeType.dimension === "process") {
      if (processId) body.processId = Number(processId);
    } else if (activeType.dimension === "queue") {
      if (queueId) body.queueId = Number(queueId);
    } else if (activeType.dimension === "attrition") {
      if (departmentId) body.departmentId = Number(departmentId);
      if (processId) body.processId = Number(processId);
      if (locationId) body.locationId = Number(locationId);
      if (designationId) body.designationId = Number(designationId);
    }

    const res = await authFetch("/api/reprocessing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSubmitting(false);
    if (!res.ok) {
      const responseBody = (await res.json()) as ApiResponse<unknown>;
      setSubmitError(!responseBody.success ? responseBody.error.message : "Could not run reprocessing.");
      return;
    }
    setReason("");
    reloadHistory();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Reprocessing</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Authorized, reasoned, on-demand recalculation (build spec section 23). Every calculation type below already
          recomputes and writes a fresh Calculation Ledger entry on every normal read (documentation/formulas.md) - this
          doesn&rsquo;t run any different math, it makes an explicit request for one a first-class, audited fact
          (system.ReprocessingRequest) instead of indistinguishable from someone reloading a report.
        </p>
      </div>

      <Card>
        <CardHeader title="Run reprocessing" />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-muted">Calculation</span>
                <select value={calculationType} onChange={(e) => setCalculationType(e.target.value as CalculationType)} className="w-80 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                  {CALCULATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-muted">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-muted">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
              </label>

              {(activeType.dimension === "department+process" || activeType.dimension === "attrition") && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Department</span>
                  <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                    <option value="">All</option>
                    {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              )}
              {(activeType.dimension === "department+process" || activeType.dimension === "process" || activeType.dimension === "attrition") && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Process</span>
                  <select value={processId} onChange={(e) => setProcessId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                    <option value="">All</option>
                    {processes?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {activeType.dimension === "attrition" && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-ink-muted">Location</span>
                    <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                      <option value="">All</option>
                      {locations?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-ink-muted">Designation</span>
                    <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                      <option value="">All</option>
                      {designations?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                </>
              )}
              {activeType.dimension === "queue" && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Queue</span>
                  <select value={queueId} onChange={(e) => setQueueId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                    <option value="">All</option>
                    {queues?.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Reason (required)</span>
              <textarea
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Re-running after correcting a data quality issue in the September queue export"
                rows={2}
                className="w-full max-w-2xl rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? "Running..." : "Run Reprocessing"}</Button>
              {submitError && <span className="text-sm text-critical">{submitError}</span>}
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Request history" subtitle={`${history?.totalItems ?? 0} request(s)`} />
        {historyLoading && <LoadingState label="Loading history" />}
        {!historyLoading && historyError && <ErrorState message={historyError} onRetry={reloadHistory} />}
        {!historyLoading && !historyError && history?.items.length === 0 && (
          <EmptyState title="No reprocessing requests yet" description="Requests you run above will appear here." />
        )}
        {!historyLoading && !historyError && history && history.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Calculation</th>
                  <th className="px-4 py-3 font-medium">Range</th>
                  <th className="px-4 py-3 font-medium">Scope</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Requested by</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((r) => (
                  <tr key={r.requestId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{CALCULATION_TYPES.find((t) => t.value === r.calculationType)?.label ?? r.calculationType}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{r.fromDate} → {r.toDate}</td>
                    <td className="px-4 py-3 text-ink-muted">{scopeSummary(r.scope)}</td>
                    <td className="px-4 py-3 text-ink-muted">{r.reason}</td>
                    <td className="px-4 py-3 text-ink-muted">{r.requestedByName ?? "—"} <span className="text-xs text-ink-faint">{new Date(r.requestedAt).toLocaleString()}</span></td>
                    <td className="px-4 py-3">
                      <Badge tone={r.status === "COMPLETED" ? "success" : "critical"}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {r.status === "COMPLETED" ? `${r.resultSummary?.itemsRecomputed ?? 0} item(s) recomputed` : (r.errorMessage ?? "—")}
                    </td>
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
