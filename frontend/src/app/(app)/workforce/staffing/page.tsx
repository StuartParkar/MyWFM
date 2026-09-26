"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface CoverageRow {
  rosterRequirementId: number;
  businessDate: string;
  departmentName: string | null;
  processName: string | null;
  shiftCode: string | null;
  requiredHc: number;
  scheduledHc: number;
  presentHc: number;
  rosterCoveragePct: number | null;
  staffingGap: number;
  actualStaffingGap: number;
}

interface IdNameRow {
  id: number;
  name: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function gapTone(gap: number): BadgeTone {
  return gap < 0 ? "critical" : gap > 0 ? "warning" : "success";
}

export default function StaffingPage() {
  const { authFetch } = useAuth();
  const [range, setRange] = useState(defaultRange);
  const [departmentId, setDepartmentId] = useState("");
  const [processId, setProcessId] = useState("");
  const [page, setPage] = useState(1);

  const lookupsFetcher = useCallback(async (): Promise<AsyncResult<{ departments: IdNameRow[]; processes: IdNameRow[] }>> => {
    try {
      const [deptRes, procRes] = await Promise.all([authFetch("/api/master-data/departments"), authFetch("/api/master-data/processes")]);
      const [deptBody, procBody] = (await Promise.all([deptRes.json(), procRes.json()])) as [ApiResponse<IdNameRow[]>, ApiResponse<{ id: number; code: string; name: string }[]>];
      return {
        ok: true,
        data: {
          departments: deptBody.success ? deptBody.data : [],
          processes: procBody.success ? procBody.data.map((p) => ({ id: p.id, name: p.name })) : [],
        },
      };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: lookups } = useAsyncResource(lookupsFetcher);

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<CoverageRow>>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: "25" });
      if (departmentId) params.set("departmentId", departmentId);
      if (processId) params.set("processId", processId);
      const res = await authFetch(`/api/staffing/coverage?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<CoverageRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, departmentId, processId, page]);
  const { data: result, error, loading, reload } = useAsyncResource(fetcher, [range, departmentId, processId, page]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Staffing</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Roster Coverage, Staffing Gap and Actual Staffing Gap (build spec section 19) against each published roster
          requirement&apos;s own Required HC. Capacity and Capacity Utilization are not shown - both need
          Workload derived from call volume, which stays unbuilt until Calls has real data (see
          documentation/formulas.md).
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">From</span>
          <input type="date" value={range.from} onChange={(e) => { setPage(1); setRange((r) => ({ ...r, from: e.target.value })); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">To</span>
          <input type="date" value={range.to} onChange={(e) => { setPage(1); setRange((r) => ({ ...r, to: e.target.value })); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Department</span>
          <select value={departmentId} onChange={(e) => { setPage(1); setDepartmentId(e.target.value); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Process</span>
          <select value={processId} onChange={(e) => { setPage(1); setProcessId(e.target.value); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {lookups?.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </Card>

      {loading && <LoadingState label="Loading staffing coverage" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="No published requirements in this range" description="Staffing coverage is computed from published roster requirements - see Roster > Requirements." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Department / Process / Shift</th>
                  <th className="px-4 py-3 font-medium">Required</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Present</th>
                  <th className="px-4 py-3 font-medium">Coverage</th>
                  <th className="px-4 py-3 font-medium">Staffing Gap</th>
                  <th className="px-4 py-3 font-medium">Actual Gap</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((r) => (
                  <tr key={r.rosterRequirementId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{r.businessDate}</td>
                    <td className="px-4 py-3 text-ink-muted">{[r.departmentName, r.processName, r.shiftCode].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.requiredHc}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.scheduledHc}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.presentHc}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.rosterCoveragePct != null ? `${r.rosterCoveragePct}%` : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={gapTone(r.staffingGap)}>{r.staffingGap >= 0 ? `+${r.staffingGap}` : r.staffingGap}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={gapTone(r.actualStaffingGap)}>{r.actualStaffingGap >= 0 ? `+${r.actualStaffingGap}` : r.actualStaffingGap}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>Page {result.page} of {result.totalPages} · {result.totalItems} requirement(s)</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
