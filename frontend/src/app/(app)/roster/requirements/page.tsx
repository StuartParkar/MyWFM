"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface RequirementRow {
  RosterRequirementId: number;
  BusinessDate: string;
  DepartmentName: string | null;
  ProcessName: string | null;
  ShiftCode: string | null;
  RequiredHC: number;
  Status: string;
  RequestedByName: string | null;
}

interface IdNameRow {
  id: number;
  name: string;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  SUBMITTED: "neutral",
  HOD_REVIEW: "info",
  WFM_REVIEW: "info",
  PUBLISHED: "success",
  REJECTED: "critical",
};

export default function RosterRequirementsPage() {
  const { authFetch } = useAuth();
  const [lookups, setLookups] = useState<{ departments: IdNameRow[]; processes: IdNameRow[]; shifts: IdNameRow[] } | null>(null);
  const [form, setForm] = useState({ businessDate: "", departmentId: "", processId: "", shiftId: "", requiredHc: "1", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [deptRes, procRes, shiftRes] = await Promise.all([
        authFetch("/api/master-data/departments"),
        authFetch("/api/master-data/processes"),
        authFetch("/api/master-data/shifts"),
      ]);
      if (cancelled) return;
      const [deptBody, procBody, shiftBody] = (await Promise.all([deptRes.json(), procRes.json(), shiftRes.json()])) as [
        ApiResponse<IdNameRow[]>,
        ApiResponse<{ id: number; name: string }[]>,
        ApiResponse<{ id: number; code: string }[]>,
      ];
      setLookups({
        departments: deptBody.success ? deptBody.data : [],
        processes: procBody.success ? procBody.data : [],
        shifts: shiftBody.success ? shiftBody.data.map((s) => ({ id: s.id, name: s.code })) : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<RequirementRow>>> => {
    try {
      const res = await authFetch("/api/roster/requirements?pageSize=50");
      const body = (await res.json()) as ApiResponse<PaginatedResult<RequirementRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: result, error, loading, reload } = useAsyncResource(fetcher);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const res = await authFetch("/api/roster/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessDate: form.businessDate,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        processId: form.processId ? Number(form.processId) : null,
        shiftId: form.shiftId ? Number(form.shiftId) : null,
        requiredHc: Number(form.requiredHc),
        notes: form.notes || null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not submit requirement.");
      return;
    }
    setForm({ businessDate: "", departmentId: "", processId: "", shiftId: "", requiredHc: "1", notes: "" });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Roster Requirements</h1>
        <p className="mt-1 text-sm text-ink-muted">Submit a headcount requirement for a business date/shift - it enters the Requestor -&gt; Leader -&gt; HOD -&gt; WFM approval chain.</p>
      </div>

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Business Date</span>
              <input type="date" required value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Department</span>
              <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                <option value="">—</option>
                {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Process</span>
              <select value={form.processId} onChange={(e) => setForm({ ...form, processId: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                <option value="">—</option>
                {lookups?.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Shift</span>
              <select value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                <option value="">—</option>
                {lookups?.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Required HC</span>
              <input type="number" min={0} required value={form.requiredHc} onChange={(e) => setForm({ ...form, requiredHc: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Notes</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <div className="col-span-full flex items-center gap-3">
              <Button type="submit" disabled={submitting}>Submit requirement</Button>
              {formError && <span className="text-sm text-critical">{formError}</span>}
            </div>
          </form>
        </CardBody>
      </Card>

      {loading && <LoadingState label="Loading requirements" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && <EmptyState title="No requirements yet" description="Submit one above to start the approval workflow." />}
      {!loading && !error && result && result.items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Department / Process</th>
                <th className="px-4 py-3 font-medium">Shift</th>
                <th className="px-4 py-3 font-medium">Required HC</th>
                <th className="px-4 py-3 font-medium">Requested By</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((r) => (
                <tr key={r.RosterRequirementId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">{r.BusinessDate}</td>
                  <td className="px-4 py-3 text-ink-muted">{[r.DepartmentName, r.ProcessName].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.ShiftCode ?? "—"}</td>
                  <td className="px-4 py-3 text-ink tabular-nums">{r.RequiredHC}</td>
                  <td className="px-4 py-3 text-ink-muted">{r.RequestedByName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[r.Status] ?? "neutral"}>{r.Status}</Badge>
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
