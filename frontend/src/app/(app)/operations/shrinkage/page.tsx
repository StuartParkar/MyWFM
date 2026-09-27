"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface DailyShrinkage {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  scheduledHours: number | null;
  totalMinutes: number;
  byCategory: { categoryCode: string; categoryName: string; minutes: number }[];
  shrinkagePct: number | null;
}

interface ShrinkageEntryRow {
  shrinkageEntryId: number;
  employeeId: string;
  businessDate: string;
  shrinkageCategoryId: number;
  categoryCode: string;
  categoryName: string;
  minutes: number;
  notes: string | null;
  source: "MANUAL" | "IMPORT" | "ADJUSTMENT";
}

interface Category {
  shrinkageCategoryId: number;
  categoryCode: string;
  categoryName: string;
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

const EMPTY_FORM = { employeeCode: "", businessDate: "", shrinkageCategoryId: "", minutes: "", notes: "" };

export default function ShrinkagePage() {
  const { authFetch } = useAuth();

  const categoriesFetcher = useCallback(async (): Promise<AsyncResult<Category[]>> => {
    try {
      const res = await authFetch("/api/shrinkage/categories");
      const body = (await res.json()) as ApiResponse<Category[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: categories } = useAsyncResource(categoriesFetcher);

  const [range, setRange] = useState(defaultRange);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ employeeId: string; businessDate: string } | null>(null);

  const summaryFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<DailyShrinkage>>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: "25" });
      const res = await authFetch(`/api/shrinkage?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<DailyShrinkage>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, page]);
  const { data: result, error, loading, reload } = useAsyncResource(summaryFetcher, [range, page]);

  const entriesFetcher = useCallback(async (): Promise<AsyncResult<ShrinkageEntryRow[] | null>> => {
    if (!selected) return { ok: true, data: null };
    try {
      const params = new URLSearchParams({ employeeId: selected.employeeId, businessDate: selected.businessDate });
      const res = await authFetch(`/api/shrinkage/entries?${params}`);
      const body = (await res.json()) as ApiResponse<ShrinkageEntryRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, selected]);
  const { data: entries, error: entriesError, loading: entriesLoading, reload: reloadEntries } = useAsyncResource(entriesFetcher, [selected]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.employeeCode.trim() || !form.businessDate || !form.shrinkageCategoryId || !form.minutes) {
      setFormError("Employee, business date, category and minutes are all required.");
      return;
    }
    setBusy(true);
    const lookupRes = await authFetch(`/api/master-data/employees?search=${encodeURIComponent(form.employeeCode)}&pageSize=1`);
    const lookupBody = (await lookupRes.json()) as ApiResponse<{ items: { employeeId: string }[] }>;
    const employeeId = lookupBody.success ? lookupBody.data.items[0]?.employeeId : undefined;
    if (!employeeId) {
      setBusy(false);
      setFormError(`No employee matches "${form.employeeCode}".`);
      return;
    }
    const res = await authFetch("/api/shrinkage/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        businessDate: form.businessDate,
        shrinkageCategoryId: Number(form.shrinkageCategoryId),
        minutes: Number(form.minutes),
        notes: form.notes || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not record the entry.");
      return;
    }
    setForm(EMPTY_FORM);
    reload();
    if (selected?.employeeId === employeeId && selected.businessDate === form.businessDate) reloadEntries();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Shrinkage</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Unavailable time by category against Scheduled Hours (build spec section 20) - manual entry / authorized
          adjustment, same as Attendance, since there is no source system for this yet either.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <Input
          label="From"
          type="date"
          value={range.from}
          onChange={(e) => {
            setPage(1);
            setRange((r) => ({ ...r, from: e.target.value }));
          }}
        />
        <Input
          label="To"
          type="date"
          value={range.to}
          onChange={(e) => {
            setPage(1);
            setRange((r) => ({ ...r, to: e.target.value }));
          }}
        />
      </Card>

      <Card>
        <CardHeader title="Record shrinkage" />
        <CardBody>
          <form onSubmit={submitEntry} className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Input label="Employee Code" value={form.employeeCode} onChange={(e) => setForm((f) => ({ ...f, employeeCode: e.target.value }))} />
            <Input label="Business Date" type="date" value={form.businessDate} onChange={(e) => setForm((f) => ({ ...f, businessDate: e.target.value }))} />
            <Select label="Category" value={form.shrinkageCategoryId} onChange={(e) => setForm((f) => ({ ...f, shrinkageCategoryId: e.target.value }))}>
              <option value="">—</option>
              {categories?.map((c) => (
                <option key={c.shrinkageCategoryId} value={c.shrinkageCategoryId}>{c.categoryName}</option>
              ))}
            </Select>
            <Input label="Minutes" type="number" min={1} value={form.minutes} onChange={(e) => setForm((f) => ({ ...f, minutes: e.target.value }))} />
            <Input label="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="col-span-full flex items-center gap-3">
              <Button type="submit" loading={busy}>Record</Button>
              {formError && <span className="text-sm text-critical">{formError}</span>}
            </div>
          </form>
        </CardBody>
      </Card>

      {loading && <LoadingState label="Loading shrinkage" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="Nothing to show" description="No published schedule or recorded shrinkage entry falls in this range." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Scheduled Hrs</th>
                  <th className="px-4 py-3 font-medium">Unavailable</th>
                  <th className="px-4 py-3 font-medium">By Category</th>
                  <th className="px-4 py-3 font-medium">Shrinkage %</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {result.items.map((r) => (
                  <tr key={`${r.employeeId}|${r.businessDate}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{r.businessDate}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {r.employeeName} <span className="text-ink-faint">#{r.employeeCode}</span>
                    </td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.scheduledHours ?? "—"}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.totalMinutes}m</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {r.byCategory.length === 0 ? "—" : r.byCategory.map((c) => `${c.categoryName} ${c.minutes}m`).join(", ")}
                    </td>
                    <td className="px-4 py-3">
                      {r.shrinkagePct != null ? <Badge tone={r.shrinkagePct > 20 ? "warning" : "neutral"}>{r.shrinkagePct}%</Badge> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" onClick={() => setSelected({ employeeId: r.employeeId, businessDate: r.businessDate })}>
                        Entries
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>Page {result.page} of {result.totalPages} · {result.totalItems} day(s)</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <Card>
          <CardHeader title={`Entries · ${selected.businessDate}`} action={<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>} />
          <CardBody className="flex flex-col gap-3">
            {entriesLoading && <LoadingState label="Loading entries" />}
            {!entriesLoading && entriesError && <ErrorState message={entriesError} onRetry={reloadEntries} />}
            {!entriesLoading && !entriesError && entries?.length === 0 && <EmptyState title="No entries recorded" description="Nothing logged for this employee on this business date." />}
            {!entriesLoading && !entriesError && entries && entries.length > 0 && (
              <div className="flex flex-col gap-3">
                {entries.map((e) => (
                  <ShrinkageEntryEditor key={e.shrinkageEntryId} entry={e} categories={categories ?? []} onChanged={reloadEntries} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ShrinkageEntryEditor({ entry, categories, onChanged }: { entry: ShrinkageEntryRow; categories: Category[]; onChanged: () => void }) {
  const { authFetch } = useAuth();
  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [shrinkageCategoryId, setShrinkageCategoryId] = useState(String(entry.shrinkageCategoryId));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function adjust() {
    if (!reason.trim()) {
      setRowError("A reason is required to adjust an entry.");
      return;
    }
    setBusy(true);
    setRowError(null);
    const patch: Record<string, unknown> = { reason };
    if (Number(minutes) !== entry.minutes) patch.minutes = Number(minutes);
    if (Number(shrinkageCategoryId) !== entry.shrinkageCategoryId) patch.shrinkageCategoryId = Number(shrinkageCategoryId);
    const res = await authFetch(`/api/shrinkage/entries/${entry.shrinkageEntryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError(!body.success ? body.error.message : "Could not adjust the entry.");
      return;
    }
    setReason("");
    onChanged();
  }

  async function remove() {
    if (!reason.trim()) {
      setRowError("A reason is required to remove an entry.");
      return;
    }
    setBusy(true);
    setRowError(null);
    const res = await authFetch(`/api/shrinkage/entries/${entry.shrinkageEntryId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError(!body.success ? body.error.message : "Could not remove the entry.");
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-lg border border-line-strong p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
        <Badge tone="neutral">{entry.categoryName}</Badge>
        <span>{entry.minutes} minutes</span>
        {entry.notes && <span className="text-ink-muted">· {entry.notes}</span>}
        <Badge tone="neutral">{entry.source}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Select label="Category" value={shrinkageCategoryId} onChange={(e) => setShrinkageCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.shrinkageCategoryId} value={c.shrinkageCategoryId}>{c.categoryName}</option>
          ))}
        </Select>
        <Input label="Minutes" type="number" min={1} className="w-24" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <Input label="Reason" className="min-w-40 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="secondary" disabled={busy} onClick={adjust}>Adjust</Button>
        <Button variant="danger" disabled={busy} onClick={remove}>Remove</Button>
      </div>
      {rowError && <p className="mt-1 text-sm text-critical">{rowError}</p>}
    </div>
  );
}
