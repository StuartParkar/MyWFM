"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface ShiftImpact {
  shiftId: number;
  shiftCode: string | null;
  beforeHc: number;
  afterHc: number;
  requiredHc: number | null;
  gap: number | null;
}

interface ImpactPreview {
  oldShift: ShiftImpact | null;
  newShift: ShiftImpact;
}

interface ChangeRow {
  id: number;
  employeeName: string;
  businessDate: string;
  oldShiftCode: string | null;
  newShiftCode: string | null;
  reason: string;
  requestedByName: string | null;
  createdAt: string;
}

interface ShiftOption {
  id: number;
  code: string;
}

interface FormState {
  employeeCode: string;
  businessDate: string;
  newShiftId: string;
  reason: string;
}

function formKey(f: FormState): string {
  return `${f.employeeCode}|${f.businessDate}|${f.newShiftId}`;
}

function ImpactPanel({ label, impact }: { label: string; impact: ShiftImpact }) {
  const gapTone = impact.gap == null ? "text-ink-muted" : impact.gap < 0 ? "text-critical" : "text-success";
  return (
    <div className="flex-1 rounded-lg border border-line-strong px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label} · {impact.shiftCode ?? "—"}
      </div>
      <div className="mt-1 text-sm text-ink">
        HC {impact.beforeHc} <span className="text-ink-faint">→</span> {impact.afterHc}
        {impact.requiredHc != null && <span className="text-ink-muted"> (required {impact.requiredHc})</span>}
      </div>
      {impact.gap != null && <div className={`text-xs ${gapTone}`}>{impact.gap >= 0 ? `+${impact.gap}` : impact.gap} vs. required</div>}
    </div>
  );
}

const EMPTY_FORM: FormState = { employeeCode: "", businessDate: "", newShiftId: "", reason: "" };

export default function RosterChangesPage() {
  const { authFetch } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [preview, setPreview] = useState<{ key: string; employeeId: string; impact: ImpactPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const shiftsFetcher = useCallback(async (): Promise<AsyncResult<ShiftOption[]>> => {
    try {
      const res = await authFetch("/api/master-data/shifts");
      const body = (await res.json()) as ApiResponse<ShiftOption[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: shifts } = useAsyncResource(shiftsFetcher);

  const historyFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<ChangeRow>>> => {
    try {
      const res = await authFetch(`/api/roster/changes?page=${page}&pageSize=25`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<ChangeRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, page]);
  const { data: history, error: historyError, loading: historyLoading, reload: reloadHistory } = useAsyncResource(historyFetcher, [page]);

  function updateForm(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
    setFormError(null);
  }

  async function previewImpact() {
    if (!form.employeeCode.trim() || !form.businessDate || !form.newShiftId) {
      setFormError("Employee, business date and new shift are all required to preview impact.");
      return;
    }
    setBusy(true);
    setFormError(null);

    const lookupRes = await authFetch(`/api/master-data/employees?search=${encodeURIComponent(form.employeeCode)}&pageSize=1`);
    const lookupBody = (await lookupRes.json()) as ApiResponse<{ items: { employeeId: string }[] }>;
    const employeeId = lookupBody.success ? lookupBody.data.items[0]?.employeeId : undefined;
    if (!employeeId) {
      setBusy(false);
      setFormError(`No employee matches "${form.employeeCode}".`);
      return;
    }

    const params = new URLSearchParams({ employeeId, businessDate: form.businessDate, newShiftId: form.newShiftId });
    const res = await authFetch(`/api/roster/change-impact?${params}`);
    const body = (await res.json()) as ApiResponse<ImpactPreview>;
    setBusy(false);
    if (!res.ok || !body.success) {
      setFormError(!body.success ? body.error.message : `Request failed (${res.status})`);
      return;
    }
    setPreview({ key: formKey(form), employeeId, impact: body.data });
  }

  async function confirmChange() {
    if (!preview || preview.key !== formKey(form)) {
      setFormError("Preview the impact again before confirming - the form changed since the last preview.");
      return;
    }
    if (!form.reason.trim()) {
      setFormError("A reason is required.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await authFetch("/api/roster/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: preview.employeeId,
        businessDate: form.businessDate,
        newShiftId: Number(form.newShiftId),
        reason: form.reason.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not record the change.");
      return;
    }
    setForm(EMPTY_FORM);
    setPreview(null);
    setPage(1);
    reloadHistory();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Roster Changes</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Preview the headcount impact of a shift change before committing it - the simulator never writes anything
          until you confirm.
        </p>
      </div>

      <Card>
        <CardHeader title="Preview a change" />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Employee Code</span>
              <input
                value={form.employeeCode}
                onChange={(e) => updateForm({ employeeCode: e.target.value })}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Business Date</span>
              <input
                type="date"
                value={form.businessDate}
                onChange={(e) => updateForm({ businessDate: e.target.value })}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">New Shift</span>
              <select
                value={form.newShiftId}
                onChange={(e) => updateForm({ newShiftId: e.target.value })}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              >
                <option value="">—</option>
                {shifts?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button variant="secondary" disabled={busy} onClick={previewImpact}>
                Preview impact
              </Button>
            </div>
          </div>

          {preview && preview.key === formKey(form) && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <div className="flex flex-wrap gap-3">
                {preview.impact.oldShift && <ImpactPanel label="Current shift" impact={preview.impact.oldShift} />}
                <ImpactPanel label="New shift" impact={preview.impact.newShift} />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-1 min-w-48 flex-col gap-1">
                  <span className="text-xs font-medium text-ink-muted">Reason</span>
                  <input
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <Button disabled={busy} onClick={confirmChange}>
                  Confirm change
                </Button>
              </div>
            </div>
          )}
          {formError && <p className="text-sm text-critical">{formError}</p>}
        </CardBody>
      </Card>

      {historyLoading && <LoadingState label="Loading roster changes" />}
      {!historyLoading && historyError && <ErrorState message={historyError} onRetry={reloadHistory} />}
      {!historyLoading && !historyError && history?.items.length === 0 && (
        <EmptyState title="No roster changes yet" description="Confirmed changes will appear here with the reason and who requested them." />
      )}
      {!historyLoading && !historyError && history && history.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Shift change</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Requested By</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{c.businessDate}</td>
                    <td className="px-4 py-3 text-ink-muted">{c.employeeName}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {c.oldShiftCode ?? "—"} <span className="text-ink-faint">→</span> {c.newShiftCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{c.reason}</td>
                    <td className="px-4 py-3 text-ink-muted">{c.requestedByName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {history.page} of {history.totalPages} · {history.totalItems} changes
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= history.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
