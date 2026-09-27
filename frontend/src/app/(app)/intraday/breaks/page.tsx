"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { combineLocalDateTime } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface CoverageRow {
  intervalStart: string;
  label: string;
  requiredHC: number;
  availableHC: number;
  availableStaffingGap: number;
}

interface BreakRow {
  breakSessionId: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  breakStart: string;
  breakEnd: string | null;
}

interface ProcessLookup {
  id: number;
  code: string;
  name: string;
}

interface ScheduledEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gapTone(gap: number): BadgeTone {
  return gap < 0 ? "critical" : gap > 0 ? "warning" : "success";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function nowAsDatetimeLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function BreakManagementPage() {
  const { authFetch } = useAuth();
  const [businessDate, setBusinessDate] = useState(() => toIsoDate(new Date()));
  const [processId, setProcessId] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/business-day/today");
        const body = (await res.json()) as ApiResponse<{ businessDate: string; timezone: string }>;
        if (!cancelled && res.ok && body.success) {
          setBusinessDate(body.data.businessDate);
          setTimezone(body.data.timezone);
        }
      } catch {
        // Keep the browser-local placeholder.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

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

  const coverageFetcher = useCallback(async (): Promise<AsyncResult<CoverageRow[]>> => {
    try {
      const params = new URLSearchParams({ businessDate });
      if (processId) params.set("processId", processId);
      const res = await authFetch(`/api/intraday/interval-summary?${params}`);
      const body = (await res.json()) as ApiResponse<CoverageRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, businessDate, processId]);
  const { data: coverage, error: coverageError, loading: coverageLoading, reload: reloadCoverage } = useAsyncResource(coverageFetcher, [businessDate, processId]);

  const breaksFetcher = useCallback(async (): Promise<AsyncResult<BreakRow[]>> => {
    try {
      const params = new URLSearchParams({ businessDate });
      if (processId) params.set("processId", processId);
      const res = await authFetch(`/api/intraday/breaks?${params}`);
      const body = (await res.json()) as ApiResponse<BreakRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, businessDate, processId]);
  const { data: breaks, error: breaksError, loading: breaksLoading, reload: reloadBreaks } = useAsyncResource(breaksFetcher, [businessDate, processId]);

  const employeesFetcher = useCallback(async (): Promise<AsyncResult<ScheduledEmployee[]>> => {
    try {
      const params = new URLSearchParams({ businessDate });
      if (processId) params.set("processId", processId);
      const res = await authFetch(`/api/intraday/breaks/scheduled-employees?${params}`);
      const body = (await res.json()) as ApiResponse<ScheduledEmployee[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, businessDate, processId]);
  const { data: scheduledEmployees } = useAsyncResource(employeesFetcher, [businessDate, processId]);

  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formBreakStart, setFormBreakStart] = useState(nowAsDatetimeLocal);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<number | null>(null);

  async function submitStartBreak(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!formEmployeeId || !formBreakStart) {
      setFormError("Employee and break start are required.");
      return;
    }
    const [date, time] = formBreakStart.split("T");
    if (!date || !time) {
      setFormError("Break start is not a valid date/time.");
      return;
    }
    setFormBusy(true);
    const breakStart = combineLocalDateTime(date, time.slice(0, 5), timezone);
    const res = await authFetch("/api/intraday/breaks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: formEmployeeId, businessDate, breakStart }),
    });
    setFormBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not start the break.");
      return;
    }
    setFormEmployeeId("");
    setFormBreakStart(nowAsDatetimeLocal());
    reloadBreaks();
    reloadCoverage();
  }

  async function endBreak(id: number) {
    setEndingId(id);
    const res = await authFetch(`/api/intraday/breaks/${id}/end`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ breakEnd: new Date().toISOString() }),
    });
    setEndingId(null);
    if (res.ok) {
      reloadBreaks();
      reloadCoverage();
    }
  }

  const exceptionCount = coverage?.filter((c) => c.availableStaffingGap < 0).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Break Management</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Real recorded break sessions (attendance.BreakSession) against the same interval-bucketed Required/
          Available HC the Intraday Control engine computes (build spec section 20) - so a break can be scheduled
          against real projected coverage, not a guess. A negative Available Gap is a coverage exception: Available
          HC (Present minus who is currently on a recorded break) has fallen below Required HC for that interval.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <Input label="Business date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        <Select label="Process" value={processId} onChange={(e) => setProcessId(e.target.value)}>
          <option value="">All processes</option>
          {processes?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Card>

      <Card>
        <CardHeader title="Start a break" subtitle="Recorded against a scheduled employee for this business date - visible immediately in the coverage table below." />
        <CardBody>
          <form onSubmit={submitStartBreak} className="flex flex-wrap items-end gap-3">
            <Select label="Employee" className="min-w-[14rem]" value={formEmployeeId} onChange={(e) => setFormEmployeeId(e.target.value)}>
              <option value="">Select an employee</option>
              {scheduledEmployees?.map((emp) => (
                <option key={emp.employeeId} value={emp.employeeId}>
                  {emp.employeeName} ({emp.employeeCode})
                </option>
              ))}
            </Select>
            <Input
              label="Break start"
              type="datetime-local"
              value={formBreakStart}
              onChange={(e) => setFormBreakStart(e.target.value)}
            />
            <Button type="submit" loading={formBusy}>
              {formBusy ? "Starting..." : "Start break"}
            </Button>
          </form>
          {formError && <p className="mt-2 text-sm text-critical">{formError}</p>}
          {scheduledEmployees?.length === 0 && <p className="mt-2 text-sm text-ink-faint">No employee is scheduled (published, non-weekly-off) for this date/process.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Breaks" subtitle={`${breaks?.length ?? 0} break session(s) recorded for this date/process.`} />
        {breaksLoading && <LoadingState label="Loading breaks" />}
        {!breaksLoading && breaksError && <ErrorState message={breaksError} onRetry={reloadBreaks} />}
        {!breaksLoading && !breaksError && breaks?.length === 0 && <EmptyState title="No breaks recorded yet" description="Use the form above to start one." />}
        {!breaksLoading && !breaksError && breaks && breaks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Break start</th>
                  <th className="px-4 py-3 font-medium">Break end</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {breaks.map((b) => (
                  <tr key={b.breakSessionId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">
                      {b.employeeName} <span className="text-ink-faint">({b.employeeCode})</span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{fmtTime(b.breakStart)}</td>
                    <td className="px-4 py-3 text-ink-muted tabular-nums">{b.breakEnd ? fmtTime(b.breakEnd) : <Badge tone="warning">Ongoing</Badge>}</td>
                    <td className="px-4 py-3 text-right">
                      {!b.breakEnd && (
                        <Button variant="secondary" onClick={() => endBreak(b.breakSessionId)} disabled={endingId === b.breakSessionId}>
                          {endingId === b.breakSessionId ? "Ending..." : "End break"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Projected coverage" subtitle={exceptionCount > 0 ? `${exceptionCount} interval(s) with a coverage exception (Available HC below Required HC).` : "No coverage exceptions across today's intervals."} />
        {coverageLoading && <LoadingState label="Loading coverage" />}
        {!coverageLoading && coverageError && <ErrorState message={coverageError} onRetry={reloadCoverage} />}
        {!coverageLoading && !coverageError && coverage && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Interval</th>
                  <th className="px-4 py-3 font-medium">Required</th>
                  <th className="px-4 py-3 font-medium">Available</th>
                  <th className="px-4 py-3 font-medium">Available Gap</th>
                </tr>
              </thead>
              <tbody>
                {coverage
                  .filter((c) => c.requiredHC > 0 || c.availableHC > 0)
                  .map((c) => (
                    <tr key={c.intervalStart} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 text-ink font-medium tabular-nums">{c.label}</td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{c.requiredHC}</td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{c.availableHC}</td>
                      <td className="px-4 py-3">
                        <Badge tone={gapTone(c.availableStaffingGap)}>{c.availableStaffingGap >= 0 ? `+${c.availableStaffingGap}` : c.availableStaffingGap}</Badge>
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
