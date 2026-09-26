"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface AttritionSummary {
  openingHC: number;
  closingHC: number;
  joiners: number;
  exits: number;
  transfers: number;
  attritionRatePct: number | null;
  employeesMissingJoinDate: number;
}

interface JoinerExitRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  date: string;
  type: "JOINED" | "EXITED";
}

interface TransferRow {
  employeeTransferId: number;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  effectiveDate: string;
  previousDepartmentName: string | null;
  newDepartmentName: string | null;
  previousLocationName: string | null;
  newLocationName: string | null;
  previousProcessName: string | null;
  newProcessName: string | null;
}

interface IdNameRow {
  id: number;
  name: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: toIsoDate(from), to: toIsoDate(now) };
}

function transferDescription(t: TransferRow): string {
  const parts: string[] = [];
  if (t.previousDepartmentName !== t.newDepartmentName) parts.push(`Department: ${t.previousDepartmentName ?? "—"} → ${t.newDepartmentName ?? "—"}`);
  if (t.previousLocationName !== t.newLocationName) parts.push(`Location: ${t.previousLocationName ?? "—"} → ${t.newLocationName ?? "—"}`);
  if (t.previousProcessName !== t.newProcessName) parts.push(`Process: ${t.previousProcessName ?? "—"} → ${t.newProcessName ?? "—"}`);
  return parts.join(", ") || "No dimension changed";
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

export default function AttritionPage() {
  const { authFetch } = useAuth();
  const [range, setRange] = useState(defaultRange);
  const [departmentId, setDepartmentId] = useState("");
  const [processId, setProcessId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [designationId, setDesignationId] = useState("");

  const departmentsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/departments"), [authFetch]);
  const processesFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/processes"), [authFetch]);
  const locationsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/locations"), [authFetch]);
  const designationsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/designations"), [authFetch]);
  const { data: departments } = useAsyncResource(departmentsFetcher);
  const { data: processes } = useAsyncResource(processesFetcher);
  const { data: locations } = useAsyncResource(locationsFetcher);
  const { data: designations } = useAsyncResource(designationsFetcher);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (departmentId) params.set("departmentId", departmentId);
    if (processId) params.set("processId", processId);
    if (locationId) params.set("locationId", locationId);
    if (designationId) params.set("designationId", designationId);
    return params;
  }, [range, departmentId, processId, locationId, designationId]);

  const summaryFetcher = useCallback(async (): Promise<AsyncResult<AttritionSummary>> => {
    try {
      const res = await authFetch(`/api/attrition/summary?${filterParams()}`);
      const body = (await res.json()) as ApiResponse<AttritionSummary>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, filterParams]);
  const { data: summary, error: summaryError, loading: summaryLoading, reload: reloadSummary } = useAsyncResource(summaryFetcher, [filterParams]);

  const joinersExitsFetcher = useCallback(async (): Promise<AsyncResult<JoinerExitRow[]>> => {
    try {
      const res = await authFetch(`/api/attrition/joiners-exits?${filterParams()}`);
      const body = (await res.json()) as ApiResponse<JoinerExitRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, filterParams]);
  const { data: joinersExits, error: joinersExitsError, loading: joinersExitsLoading } = useAsyncResource(joinersExitsFetcher, [filterParams]);

  const transfersFetcher = useCallback(async (): Promise<AsyncResult<TransferRow[]>> => {
    try {
      const res = await authFetch(`/api/attrition/transfers?${filterParams()}`);
      const body = (await res.json()) as ApiResponse<TransferRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, filterParams]);
  const { data: transfers, error: transfersError, loading: transfersLoading } = useAsyncResource(transfersFetcher, [filterParams]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Attrition</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Opening/Closing HC, Joiners, Exits, Transfers and Attrition Rate (build spec section
          22), from real <code>master.Employee.JoinDate</code>/<code>LeftDate</code> and the
          <code> master.EmployeeTransfer</code> log. Join/exit dates are system-observed
          (first-seen on an org-hierarchy import, last-seen-then-missing on a later one) unless a
          real HR date was entered manually via Admin &gt; Employees, which always takes
          precedence - see documentation/attrition.md.
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
          <span className="text-xs font-medium text-ink-muted">Department</span>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {departments?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Process</span>
          <select value={processId} onChange={(e) => setProcessId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {processes?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Location</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Designation</span>
          <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All</option>
            {designations?.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      </Card>

      {summaryLoading && <LoadingState label="Loading summary" />}
      {!summaryLoading && summaryError && <ErrorState message={summaryError} onRetry={reloadSummary} />}
      {!summaryLoading && !summaryError && summary && (
        <Card>
          <CardBody className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Opening HC</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{summary.openingHC}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Closing HC</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{summary.closingHC}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Joiners</p>
              <p className="text-xl font-semibold text-success tabular-nums">+{summary.joiners}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Exits</p>
              <p className="text-xl font-semibold text-critical tabular-nums">-{summary.exits}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Transfers</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{summary.transfers}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Attrition Rate</p>
              <p className="text-xl font-semibold text-ink tabular-nums">{summary.attritionRatePct != null ? `${summary.attritionRatePct}%` : "—"}</p>
            </div>
          </CardBody>
          {summary.employeesMissingJoinDate > 0 && (
            <CardBody className="border-t border-line pt-3">
              <Badge tone="warning">{summary.employeesMissingJoinDate} active employee(s) have no Join Date on record</Badge>
              <p className="mt-1 text-xs text-ink-faint">
                Not counted as a joiner anywhere until one is set (import re-run or Admin &gt; Employees) - see documentation/attrition.md.
              </p>
            </CardBody>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Joiners & Exits" subtitle={`${joinersExits?.length ?? 0} in range`} />
        {joinersExitsLoading && <LoadingState label="Loading" />}
        {!joinersExitsLoading && joinersExitsError && <ErrorState message={joinersExitsError} />}
        {!joinersExitsLoading && !joinersExitsError && joinersExits?.length === 0 && <EmptyState title="No joiners or exits in range" description="Nothing matches this filter yet." />}
        {!joinersExitsLoading && !joinersExitsError && joinersExits && joinersExits.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {joinersExits.map((r, i) => (
                  <tr key={`${r.employeeId}-${r.type}-${i}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">
                      {r.fullName} <span className="text-xs text-ink-faint">(#{r.employeeCode})</span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{r.date}</td>
                    <td className="px-4 py-3">
                      <Badge tone={r.type === "JOINED" ? "success" : "critical"}>{r.type === "JOINED" ? "Joined" : "Exited"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Transfers" subtitle={`${transfers?.length ?? 0} in range`} />
        {transfersLoading && <LoadingState label="Loading" />}
        {!transfersLoading && transfersError && <ErrorState message={transfersError} />}
        {!transfersLoading && !transfersError && transfers?.length === 0 && <EmptyState title="No transfers in range" description="No Department/Location/primary-Process change was detected for this filter yet." />}
        {!transfersLoading && !transfersError && transfers && transfers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.employeeTransferId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">
                      {t.fullName} <span className="text-xs text-ink-faint">(#{t.employeeCode})</span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{t.effectiveDate}</td>
                    <td className="px-4 py-3 text-ink-muted">{transferDescription(t)}</td>
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
