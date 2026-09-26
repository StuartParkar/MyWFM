"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { combineLocalDateTime } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface DailySummary {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  shiftCode: string | null;
  isWeeklyOff: boolean;
  scheduledHours: number | null;
  firstLogin: string | null;
  lastLogout: string | null;
  netWorkingHours: number | null;
  varianceHours: number | null;
  lateMinutes: number | null;
  earlyLogoutMinutes: number | null;
  doubleShiftException: boolean;
  sessionCount: number;
  status: "PRESENT" | "ABSENT" | "ON_WEEKLY_OFF";
}

interface SessionRow {
  attendanceSessionId: number;
  employeeId: string;
  businessDate: string;
  sessionStart: string;
  sessionEnd: string | null;
  breakMinutes: number;
  source: "MANUAL" | "IMPORT" | "ADJUSTMENT";
}

const STATUS_TONE: Record<DailySummary["status"], BadgeTone> = { PRESENT: "success", ABSENT: "critical", ON_WEEKLY_OFF: "neutral" };

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
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

const EMPTY_ENTRY_FORM = { employeeCode: "", businessDate: "", sessionStart: "", sessionEnd: "", breakMinutes: "0", reason: "" };

export default function AttendancePage() {
  const { authFetch } = useAuth();
  const [businessDay, setBusinessDay] = useState<{ businessDate: string; timezone: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await authFetch("/api/business-day/today");
      const body = (await res.json()) as ApiResponse<{ businessDate: string; timezone: string }>;
      if (!cancelled && body.success) setBusinessDay(body.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  const [range, setRange] = useState(defaultRange);
  const [employeeCode, setEmployeeCode] = useState("");
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [employeeFilterError, setEmployeeFilterError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ employeeId: string; businessDate: string } | null>(null);

  async function applyEmployeeFilter() {
    setEmployeeFilterError(null);
    if (!employeeCode.trim()) {
      setEmployeeId(undefined);
      setPage(1);
      return;
    }
    const res = await authFetch(`/api/master-data/employees?search=${encodeURIComponent(employeeCode)}&pageSize=1`);
    const body = (await res.json()) as ApiResponse<{ items: { employeeId: string }[] }>;
    const id = body.success ? body.data.items[0]?.employeeId : undefined;
    if (!id) {
      setEmployeeFilterError(`No employee matches "${employeeCode}".`);
      return;
    }
    setEmployeeId(id);
    setPage(1);
  }

  const summaryFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<DailySummary>>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: "25" });
      if (employeeId) params.set("employeeId", employeeId);
      const res = await authFetch(`/api/attendance?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<DailySummary>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, employeeId, page]);
  const { data: result, error, loading, reload } = useAsyncResource(summaryFetcher, [range, employeeId, page]);

  const sessionsFetcher = useCallback(async (): Promise<AsyncResult<SessionRow[] | null>> => {
    if (!selected) return { ok: true, data: null };
    try {
      const params = new URLSearchParams({ employeeId: selected.employeeId, businessDate: selected.businessDate });
      const res = await authFetch(`/api/attendance/sessions?${params}`);
      const body = (await res.json()) as ApiResponse<SessionRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, selected]);
  const { data: sessions, error: sessionsError, loading: sessionsLoading, reload: reloadSessions } = useAsyncResource(sessionsFetcher, [selected]);

  const [entryForm, setEntryForm] = useState(EMPTY_ENTRY_FORM);
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);

  function localToInstant(value: string): string | null {
    if (!value || !businessDay) return null;
    const [date, time] = value.split("T");
    if (!date || !time) return null;
    return combineLocalDateTime(date, time.slice(0, 5), businessDay.timezone);
  }

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!businessDay) return;
    setEntryError(null);
    if (!entryForm.employeeCode.trim() || !entryForm.businessDate || !entryForm.sessionStart) {
      setEntryError("Employee, business date and session start are required.");
      return;
    }
    setEntryBusy(true);
    const lookupRes = await authFetch(`/api/master-data/employees?search=${encodeURIComponent(entryForm.employeeCode)}&pageSize=1`);
    const lookupBody = (await lookupRes.json()) as ApiResponse<{ items: { employeeId: string }[] }>;
    const employeeIdForEntry = lookupBody.success ? lookupBody.data.items[0]?.employeeId : undefined;
    if (!employeeIdForEntry) {
      setEntryBusy(false);
      setEntryError(`No employee matches "${entryForm.employeeCode}".`);
      return;
    }
    const sessionStart = localToInstant(entryForm.sessionStart);
    const sessionEnd = entryForm.sessionEnd ? localToInstant(entryForm.sessionEnd) : null;
    if (!sessionStart) {
      setEntryBusy(false);
      setEntryError("Session start is not a valid date/time.");
      return;
    }
    const res = await authFetch("/api/attendance/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: employeeIdForEntry,
        businessDate: entryForm.businessDate,
        sessionStart,
        sessionEnd,
        breakMinutes: Number(entryForm.breakMinutes) || 0,
        reason: entryForm.reason || null,
      }),
    });
    setEntryBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setEntryError(!body.success ? body.error.message : "Could not record the session.");
      return;
    }
    setEntryForm(EMPTY_ENTRY_FORM);
    reload();
    if (selected?.employeeId === employeeIdForEntry && selected.businessDate === entryForm.businessDate) reloadSessions();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Attendance</h1>
        <p className="mt-1 text-sm text-ink-muted">
          First login, last logout, net working hours and variance against the published roster - derived from
          recorded attendance sessions and the Business Day Engine, never overwritten in place (see
          documentation/attendance.md). No import source exists yet, so every session here is manual entry or an
          authorized adjustment.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">From</span>
          <input
            type="date"
            value={range.from}
            onChange={(e) => {
              setPage(1);
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">To</span>
          <input
            type="date"
            value={range.to}
            onChange={(e) => {
              setPage(1);
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Employee Code (optional)</span>
          <input
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
            className="w-48 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <Button variant="secondary" onClick={applyEmployeeFilter}>Apply filter</Button>
        {employeeFilterError && <span className="text-sm text-critical">{employeeFilterError}</span>}
      </Card>

      <Card>
        <CardHeader title="Record a session" subtitle="Manual entry / authorized adjustment - every source is stored, never guessed." />
        <CardBody>
          <form onSubmit={submitEntry} className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Employee Code</span>
              <input
                value={entryForm.employeeCode}
                onChange={(e) => setEntryForm((f) => ({ ...f, employeeCode: e.target.value }))}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Business Date</span>
              <input
                type="date"
                value={entryForm.businessDate}
                onChange={(e) => setEntryForm((f) => ({ ...f, businessDate: e.target.value }))}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Session Start ({businessDay?.timezone ?? "…"})</span>
              <input
                type="datetime-local"
                value={entryForm.sessionStart}
                onChange={(e) => setEntryForm((f) => ({ ...f, sessionStart: e.target.value }))}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Session End (optional)</span>
              <input
                type="datetime-local"
                value={entryForm.sessionEnd}
                onChange={(e) => setEntryForm((f) => ({ ...f, sessionEnd: e.target.value }))}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Break Minutes</span>
              <input
                type="number"
                min={0}
                value={entryForm.breakMinutes}
                onChange={(e) => setEntryForm((f) => ({ ...f, breakMinutes: e.target.value }))}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 md:col-span-3">
              <span className="text-xs font-medium text-ink-muted">Reason (optional)</span>
              <input
                value={entryForm.reason}
                onChange={(e) => setEntryForm((f) => ({ ...f, reason: e.target.value }))}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <div className="col-span-full flex items-center gap-3">
              <Button type="submit" disabled={entryBusy || !businessDay}>Record session</Button>
              {entryError && <span className="text-sm text-critical">{entryError}</span>}
            </div>
          </form>
        </CardBody>
      </Card>

      {loading && <LoadingState label="Loading attendance" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="Nothing to show" description="No published schedule or recorded session falls in this range." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">First Login</th>
                  <th className="px-4 py-3 font-medium">Last Logout</th>
                  <th className="px-4 py-3 font-medium">Net Hrs</th>
                  <th className="px-4 py-3 font-medium">Variance</th>
                  <th className="px-4 py-3 font-medium">Late / Early</th>
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
                    <td className="px-4 py-3 text-ink-muted">{r.isWeeklyOff ? "Weekly Off" : (r.shiftCode ?? "—")}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                      {r.doubleShiftException && <Badge tone="warning">DOUBLE SHIFT</Badge>}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{fmt(r.firstLogin)}</td>
                    <td className="px-4 py-3 text-ink-muted">{fmt(r.lastLogout)}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{r.netWorkingHours ?? "—"}</td>
                    <td className={`px-4 py-3 tabular-nums ${r.varianceHours != null && r.varianceHours < 0 ? "text-critical" : "text-ink"}`}>
                      {r.varianceHours ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {r.lateMinutes ? `Late ${r.lateMinutes}m` : ""} {r.earlyLogoutMinutes ? `Early ${r.earlyLogoutMinutes}m` : ""}
                      {!r.lateMinutes && !r.earlyLogoutMinutes ? "—" : ""}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" onClick={() => setSelected({ employeeId: r.employeeId, businessDate: r.businessDate })}>
                        Sessions ({r.sessionCount})
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {result.page} of {result.totalPages} · {result.totalItems} day(s)
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <Card>
          <CardHeader
            title={`Sessions · ${selected.businessDate}`}
            action={<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>}
          />
          <CardBody className="flex flex-col gap-3">
            {sessionsLoading && <LoadingState label="Loading sessions" />}
            {!sessionsLoading && sessionsError && <ErrorState message={sessionsError} onRetry={reloadSessions} />}
            {!sessionsLoading && !sessionsError && sessions?.length === 0 && (
              <EmptyState title="No sessions recorded" description="Nothing has been logged for this employee on this business date yet." />
            )}
            {!sessionsLoading && !sessionsError && sessions && sessions.length > 0 && (
              <div className="flex flex-col gap-3">
                {sessions.map((s) => (
                  <SessionRowEditor key={s.attendanceSessionId} session={s} timezone={businessDay?.timezone ?? "UTC"} onChanged={reloadSessions} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SessionRowEditor({ session, timezone, onChanged }: { session: SessionRow; timezone: string; onChanged: () => void }) {
  const { authFetch } = useAuth();
  const [sessionEnd, setSessionEnd] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(String(session.breakMinutes));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function adjust() {
    if (!reason.trim()) {
      setRowError("A reason is required to adjust a session.");
      return;
    }
    setBusy(true);
    setRowError(null);
    const patch: Record<string, unknown> = { reason };
    if (sessionEnd) {
      const [date, time] = sessionEnd.split("T");
      if (date && time) patch.sessionEnd = combineLocalDateTime(date, time.slice(0, 5), timezone);
    }
    if (Number(breakMinutes) !== session.breakMinutes) patch.breakMinutes = Number(breakMinutes);
    const res = await authFetch(`/api/attendance/sessions/${session.attendanceSessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError(!body.success ? body.error.message : "Could not adjust the session.");
      return;
    }
    setSessionEnd("");
    setReason("");
    onChanged();
  }

  async function remove() {
    if (!reason.trim()) {
      setRowError("A reason is required to remove a session.");
      return;
    }
    setBusy(true);
    setRowError(null);
    const res = await authFetch(`/api/attendance/sessions/${session.attendanceSessionId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError(!body.success ? body.error.message : "Could not remove the session.");
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-lg border border-line-strong p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
        <span>{fmt(session.sessionStart)}</span>
        <span className="text-ink-faint">→</span>
        <span>{fmt(session.sessionEnd)}</span>
        <span className="text-ink-muted">· {session.breakMinutes}m break</span>
        <Badge tone="neutral">{session.source}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">New Session End</span>
          <input type="datetime-local" value={sessionEnd} onChange={(e) => setSessionEnd(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Break Minutes</span>
          <input type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink" />
        </label>
        <label className="flex flex-1 min-w-40 flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink" />
        </label>
        <Button variant="secondary" disabled={busy} onClick={adjust}>Adjust</Button>
        <Button variant="danger" disabled={busy} onClick={remove}>Remove</Button>
      </div>
      {rowError && <p className="mt-1 text-sm text-critical">{rowError}</p>}
    </div>
  );
}
