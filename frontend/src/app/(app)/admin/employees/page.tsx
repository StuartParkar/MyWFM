"use client";

import { Fragment, useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface EmployeeListItem {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  aliasName: string | null;
  locationName: string | null;
  departmentName: string | null;
  designationName: string | null;
  teamLeaderName: string | null;
  unitHodName: string | null;
  isActive: boolean;
  joinDate: string | null;
  leftDate: string | null;
}

interface IdNameRow {
  id: number;
  name: string;
}

const PAGE_SIZE = 25;

function AddEmployeeForm({ onAdded }: { onAdded: () => void }) {
  const { authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [lookups, setLookups] = useState<{ departments: IdNameRow[]; locations: IdNameRow[]; designations: IdNameRow[] } | null>(null);
  const [form, setForm] = useState({ employeeCode: "", fullName: "", aliasName: "", departmentId: "", locationId: "", designationId: "", joinDate: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function openForm() {
    setOpen(true);
    if (lookups) return;
    const [deptRes, locRes, desRes] = await Promise.all([
      authFetch("/api/master-data/departments"),
      authFetch("/api/master-data/locations"),
      authFetch("/api/master-data/designations"),
    ]);
    const [deptBody, locBody, desBody] = (await Promise.all([deptRes.json(), locRes.json(), desRes.json()])) as [
      ApiResponse<IdNameRow[]>,
      ApiResponse<{ id: number; name: string; code: string }[]>,
      ApiResponse<{ id: number; name: string }[]>,
    ];
    setLookups({
      departments: deptBody.success ? deptBody.data : [],
      locations: locBody.success ? locBody.data.map((l) => ({ id: l.id, name: l.name })) : [],
      designations: desBody.success ? desBody.data : [],
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const res = await authFetch("/api/master-data/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeCode: form.employeeCode,
        fullName: form.fullName,
        aliasName: form.aliasName || null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        locationId: form.locationId ? Number(form.locationId) : null,
        designationId: form.designationId ? Number(form.designationId) : null,
        joinDate: form.joinDate || null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not add employee.");
      return;
    }
    setForm({ employeeCode: "", fullName: "", aliasName: "", departmentId: "", locationId: "", designationId: "", joinDate: "" });
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={openForm}>
        Add Employee
      </Button>
    );
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Employee Code</span>
            <input required value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Full Name</span>
            <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Alias</span>
            <input value={form.aliasName} onChange={(e) => setForm({ ...form, aliasName: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Department</span>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
              <option value="">—</option>
              {lookups?.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Location</span>
            <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
              <option value="">—</option>
              {lookups?.locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Designation</span>
            <select value={form.designationId} onChange={(e) => setForm({ ...form, designationId: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
              <option value="">—</option>
              {lookups?.designations.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Join Date (if known)</span>
            <input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent" />
          </label>
          <div className="col-span-full flex items-center gap-3">
            <Button type="submit" disabled={submitting}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {formError && <span className="text-sm text-critical">{formError}</span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export default function EmployeesPage() {
  const { authFetch } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<EmployeeListItem>>> => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search) params.set("search", search);
      const res = await authFetch(`/api/master-data/employees?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<EmployeeListItem>>;
      if (!res.ok || !body.success) {
        return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      }
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, page, search]);

  const { data: result, error, loading, reload } = useAsyncResource(fetcher, [page, search]);

  async function toggleActive(emp: EmployeeListItem) {
    await authFetch(`/api/master-data/employees/${emp.employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !emp.isActive }),
    });
    reload();
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [dateForm, setDateForm] = useState({ joinDate: "", leftDate: "" });
  const [dateSaving, setDateSaving] = useState(false);

  function startEditingDates(emp: EmployeeListItem) {
    setEditingId(emp.employeeId);
    setDateForm({ joinDate: emp.joinDate ?? "", leftDate: emp.leftDate ?? "" });
  }

  async function saveDates(employeeId: string) {
    setDateSaving(true);
    await authFetch(`/api/master-data/employees/${employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinDate: dateForm.joinDate || null, leftDate: dateForm.leftDate || null }),
    });
    setDateSaving(false);
    setEditingId(null);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">Employees</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Loaded from the real organizational hierarchy - see imports/samples/master-data/README.md for how the
            hierarchy below was derived.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="search"
            placeholder="Search name, code, alias…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            className="w-64 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />
        </div>
      </div>

      <AddEmployeeForm onAdded={reload} />

      {loading && <LoadingState label="Loading employees" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="No employees found" description="Try a different search, or run the org-hierarchy import (npm run import:org-hierarchy --workspace=backend)." />
      )}

      {!loading && !error && result && result.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Designation</th>
                  <th className="px-4 py-3 font-medium">Team Leader</th>
                  <th className="px-4 py-3 font-medium">Unit HOD</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Join / Left</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {result.items.map((emp) => (
                  <Fragment key={emp.employeeId}>
                    <tr className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <div className="text-ink">{emp.fullName}</div>
                        <div className="text-xs text-ink-faint">
                          #{emp.employeeCode}
                          {emp.aliasName ? ` · ${emp.aliasName}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{emp.departmentName ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{emp.locationName ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{emp.designationName ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{emp.teamLeaderName ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{emp.unitHodName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge tone={emp.isActive ? "success" : "neutral"}>{emp.isActive ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-faint">
                        {emp.joinDate ?? "—"} / {emp.leftDate ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={() => startEditingDates(emp)}>
                            Edit dates
                          </Button>
                          <Button variant="ghost" onClick={() => toggleActive(emp)}>
                            {emp.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {editingId === emp.employeeId && (
                      <tr className="border-b border-line bg-canvas last:border-0">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-ink-muted">Join Date</span>
                              <input
                                type="date"
                                value={dateForm.joinDate}
                                onChange={(e) => setDateForm((f) => ({ ...f, joinDate: e.target.value }))}
                                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-ink-muted">Left Date</span>
                              <input
                                type="date"
                                value={dateForm.leftDate}
                                onChange={(e) => setDateForm((f) => ({ ...f, leftDate: e.target.value }))}
                                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                              />
                            </label>
                            <Button onClick={() => saveDates(emp.employeeId)} disabled={dateSaving}>
                              {dateSaving ? "Saving..." : "Save"}
                            </Button>
                            <Button variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-ink-faint">
                            A real HR-confirmed date entered here always takes precedence over the org-hierarchy import&apos;s own first-seen/last-seen inference - see documentation/attrition.md.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {result.page} of {result.totalPages} · {result.totalItems} employees
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
