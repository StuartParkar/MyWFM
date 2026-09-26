"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

type RequestType = "OVERTIME" | "VTO";
type RequestStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";

interface CapacityRequestRow {
  requestId: number;
  requestType: RequestType;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  hoursRequested: number;
  reason: string | null;
  status: RequestStatus;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
}

interface ImpactBucket {
  intervalStart: string;
  label: string;
  beforeStaffingGap: number;
  afterStaffingGap: number;
}

interface ScheduledEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
}

const STATUS_TONE: Record<RequestStatus, BadgeTone> = { REQUESTED: "warning", APPROVED: "success", REJECTED: "critical", CANCELLED: "neutral" };

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gapTone(gap: number): BadgeTone {
  return gap < 0 ? "critical" : gap > 0 ? "warning" : "success";
}

export default function OtVtoPage() {
  const { authFetch, user } = useAuth();
  const canActForOthers = user?.permissions.includes("intraday.manage") ?? false;
  const canApprove = user?.permissions.includes("intraday.approve") ?? false;

  const [statusFilter, setStatusFilter] = useState("REQUESTED");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  const listFetcher = useCallback(async (): Promise<AsyncResult<CapacityRequestRow[]>> => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await authFetch(`/api/intraday/capacity-requests?${params}`);
      const body = (await res.json()) as ApiResponse<CapacityRequestRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, statusFilter]);
  const { data: rows, error, loading, reload } = useAsyncResource(listFetcher, [statusFilter]);

  async function decide(id: number, decision: "approve" | "reject") {
    setBusyId(id);
    setRowError(null);
    const res = await authFetch(`/api/intraday/capacity-requests/${id}/${decision}`, { method: "PATCH" });
    setBusyId(null);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError({ id, message: !body.success ? body.error.message : `Could not ${decision}.` });
      return;
    }
    reload();
  }

  async function cancel(id: number) {
    setBusyId(id);
    setRowError(null);
    const res = await authFetch(`/api/intraday/capacity-requests/${id}/cancel`, { method: "PATCH" });
    setBusyId(null);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError({ id, message: !body.success ? body.error.message : "Could not cancel." });
      return;
    }
    reload();
  }

  // --- Submit form ---
  const [formType, setFormType] = useState<RequestType>("OVERTIME");
  const [formBusinessDate, setFormBusinessDate] = useState(() => toIsoDate(new Date()));
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formHours, setFormHours] = useState("1");
  const [formReason, setFormReason] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const employeesFetcher = useCallback(async (): Promise<AsyncResult<ScheduledEmployee[]>> => {
    if (!canActForOthers) return { ok: true, data: [] };
    try {
      const res = await authFetch(`/api/intraday/breaks/scheduled-employees?businessDate=${formBusinessDate}`);
      const body = (await res.json()) as ApiResponse<ScheduledEmployee[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, formBusinessDate, canActForOthers]);
  const { data: scheduledEmployees } = useAsyncResource(employeesFetcher, [formBusinessDate, canActForOthers]);

  const impactFetcher = useCallback(async (): Promise<AsyncResult<ImpactBucket[] | null>> => {
    const hours = Number(formHours);
    const employeeId = canActForOthers ? formEmployeeId : "self";
    if (!employeeId || !formBusinessDate || !hours || hours <= 0) return { ok: true, data: null };
    if (canActForOthers && !formEmployeeId) return { ok: true, data: null };
    try {
      const params = new URLSearchParams({ businessDate: formBusinessDate, requestType: formType, hoursRequested: String(hours) });
      if (canActForOthers) params.set("employeeId", formEmployeeId);
      else return { ok: true, data: null }; // impact preview needs a concrete employeeId; self-service users don't have one to pass client-side (resolved server-side on submit instead)
      const res = await authFetch(`/api/intraday/capacity-requests/impact?${params}`);
      const body = (await res.json()) as ApiResponse<ImpactBucket[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, formBusinessDate, formEmployeeId, formType, formHours, canActForOthers]);
  const { data: impact, loading: impactLoading } = useAsyncResource(impactFetcher, [formBusinessDate, formEmployeeId, formType, formHours, canActForOthers]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormMessage(null);
    const hours = Number(formHours);
    if (!hours || hours <= 0) {
      setFormError("Hours requested must be a positive number.");
      return;
    }
    if (canActForOthers && !formEmployeeId) {
      setFormError("Select an employee.");
      return;
    }
    setFormBusy(true);
    const res = await authFetch("/api/intraday/capacity-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: formType,
        employeeId: canActForOthers ? formEmployeeId : undefined,
        businessDate: formBusinessDate,
        hoursRequested: hours,
        reason: formReason || null,
      }),
    });
    setFormBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not submit the request.");
      return;
    }
    setFormMessage("Request submitted.");
    setFormEmployeeId("");
    setFormReason("");
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Overtime / VTO</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Overtime and Voluntary Time Off (including early release - a VTO request for part of a shift) requests,
          with a real before/after Staffing Gap preview for the specific intervals your requested hours would add
          or remove (build spec section 20). This preview is a single-employee, real-data delta - not the general
          what-if simulator, which is Phase 10&rsquo;s Scenario Planning.
        </p>
      </div>

      <Card>
        <CardHeader title="Submit a request" />
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={submitRequest} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Type</span>
              <select value={formType} onChange={(e) => setFormType(e.target.value as RequestType)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                <option value="OVERTIME">Overtime</option>
                <option value="VTO">VTO / early release</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Business date</span>
              <input
                type="date"
                value={formBusinessDate}
                onChange={(e) => {
                  setFormBusinessDate(e.target.value);
                  setFormEmployeeId("");
                }}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            {canActForOthers && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-muted">Employee</span>
                <select value={formEmployeeId} onChange={(e) => setFormEmployeeId(e.target.value)} className="min-w-[14rem] rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                  <option value="">Select an employee</option>
                  {scheduledEmployees?.map((emp) => (
                    <option key={emp.employeeId} value={emp.employeeId}>
                      {emp.employeeName} ({emp.employeeCode})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Hours</span>
              <input type="number" min="0.5" max="24" step="0.5" value={formHours} onChange={(e) => setFormHours(e.target.value)} className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Reason</span>
              <input type="text" value={formReason} onChange={(e) => setFormReason(e.target.value)} className="min-w-[12rem] rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <Button type="submit" disabled={formBusy}>
              {formBusy ? "Submitting..." : "Submit request"}
            </Button>
          </form>
          {!canActForOthers && <p className="text-xs text-ink-faint">This submits for your own linked employee record.</p>}
          {formError && <p className="text-sm text-critical">{formError}</p>}
          {formMessage && <p className="text-sm text-success">{formMessage}</p>}

          {canActForOthers && formEmployeeId && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Capacity impact preview</p>
              {impactLoading && <LoadingState label="Loading impact" />}
              {!impactLoading && impact && impact.length === 0 && <p className="mt-1 text-sm text-ink-faint">No interval falls in the affected window (check the business date has a published schedule).</p>}
              {!impactLoading && impact && impact.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                        <th className="px-4 py-2 font-medium">Interval</th>
                        <th className="px-4 py-2 font-medium">Gap before</th>
                        <th className="px-4 py-2 font-medium">Gap after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impact.map((b) => (
                        <tr key={b.intervalStart} className="border-b border-line last:border-0">
                          <td className="px-4 py-2 text-ink tabular-nums">{b.label}</td>
                          <td className="px-4 py-2">
                            <Badge tone={gapTone(b.beforeStaffingGap)}>{b.beforeStaffingGap >= 0 ? `+${b.beforeStaffingGap}` : b.beforeStaffingGap}</Badge>
                          </td>
                          <td className="px-4 py-2">
                            <Badge tone={gapTone(b.afterStaffingGap)}>{b.afterStaffingGap >= 0 ? `+${b.afterStaffingGap}` : b.afterStaffingGap}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="REQUESTED">Requested (pending)</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="">All</option>
          </select>
        </label>
      </Card>

      {loading && <LoadingState label="Loading requests" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && rows?.length === 0 && <EmptyState title="No requests" description="Nothing matches this filter yet." />}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.requestId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{r.requestType === "VTO" ? "VTO" : "Overtime"}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {r.employeeName} ({r.employeeCode}) - {r.businessDate} - {r.hoursRequested}h
                  </p>
                  {r.reason && <p className="mt-1 text-xs text-ink-faint">Reason: {r.reason}</p>}
                  <p className="mt-1 text-xs text-ink-faint">Requested by {r.requestedByName} on {new Date(r.requestedAt).toLocaleString()}</p>
                  {r.decidedByName && (
                    <p className="mt-1 text-xs text-ink-faint">
                      {r.status === "APPROVED" ? "Approved" : r.status === "REJECTED" ? "Rejected" : "Decided"} by {r.decidedByName}
                      {r.decisionNotes ? `: ${r.decisionNotes}` : ""}
                    </p>
                  )}
                </div>
                {r.status === "REQUESTED" && (
                  <div className="flex gap-2">
                    {canApprove && (
                      <>
                        <Button variant="secondary" onClick={() => decide(r.requestId, "reject")} disabled={busyId === r.requestId}>
                          Reject
                        </Button>
                        <Button onClick={() => decide(r.requestId, "approve")} disabled={busyId === r.requestId}>
                          Approve
                        </Button>
                      </>
                    )}
                    {(r.requestedByUserId === user?.userId || canActForOthers) && (
                      <Button variant="ghost" onClick={() => cancel(r.requestId)} disabled={busyId === r.requestId}>
                        Cancel
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {rowError?.id === r.requestId && <p className="mt-2 text-sm text-critical">{rowError.message}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
