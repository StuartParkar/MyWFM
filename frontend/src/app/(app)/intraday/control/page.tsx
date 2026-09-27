"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface IntervalBucket {
  intervalStart: string;
  label: string;
  requiredHC: number;
  scheduledHC: number;
  presentHC: number;
  availableHC: number;
  staffingGap: number;
  availableStaffingGap: number;
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  ahtSeconds: number | null;
  serviceLevelPct: number | null;
  occupancyPct: number | null;
}

interface ProcessLookup {
  id: number;
  code: string;
  name: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gapTone(gap: number): BadgeTone {
  return gap < 0 ? "critical" : gap > 0 ? "warning" : "success";
}

export default function IntradayControlPage() {
  const { authFetch } = useAuth();
  const [businessDate, setBusinessDate] = useState(() => toIsoDate(new Date()));
  const [processId, setProcessId] = useState("");

  // Real (config-driven) business-today, replacing the browser-local placeholder above once it
  // loads - same fallback-then-replace approach as FilterContext.tsx's own businessTodayRef.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/business-day/today");
        const body = (await res.json()) as ApiResponse<{ businessDate: string }>;
        if (!cancelled && res.ok && body.success) setBusinessDate(body.data.businessDate);
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

  const fetcher = useCallback(async (): Promise<AsyncResult<IntervalBucket[]>> => {
    try {
      const params = new URLSearchParams({ businessDate });
      if (processId) params.set("processId", processId);
      const res = await authFetch(`/api/intraday/interval-summary?${params}`);
      const body = (await res.json()) as ApiResponse<IntervalBucket[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, businessDate, processId]);
  const { data: buckets, error, loading, reload } = useAsyncResource(fetcher, [businessDate, processId]);

  const activeBuckets = buckets?.filter((b) => b.requiredHC > 0 || b.scheduledHC > 0 || b.offeredCalls > 0) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Intraday Control</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Required/Scheduled/Present/Available HC, Staffing Gap, Calls, AHT, Service Level and Occupancy for one
          business date, bucketed into a configurable interval (build spec section 20). Every number is derived on
          read from the published roster, real attendance/break sessions and real call records already in the
          system - nothing here is a live feed. Rows with no requirement, schedule or call activity at all are
          hidden below; see documentation/intraday.md.
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

      {loading && <LoadingState label="Loading intraday control" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && activeBuckets.length === 0 && (
        <EmptyState
          title="No requirement, schedule or call activity on this date"
          description="Nothing is published, scheduled or recorded for this business date/process yet."
        />
      )}
      {!loading && !error && activeBuckets.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Interval</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">Scheduled</th>
                <th className="px-4 py-3 font-medium">Present</th>
                <th className="px-4 py-3 font-medium">Available</th>
                <th className="px-4 py-3 font-medium">Gap</th>
                <th className="px-4 py-3 font-medium">Available Gap</th>
                <th className="px-4 py-3 font-medium">Offered</th>
                <th className="px-4 py-3 font-medium">Answered</th>
                <th className="px-4 py-3 font-medium">Abandoned</th>
                <th className="px-4 py-3 font-medium">AHT</th>
                <th className="px-4 py-3 font-medium">Service Level</th>
                <th className="px-4 py-3 font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {activeBuckets.map((b) => (
                <tr key={b.intervalStart} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink font-medium tabular-nums">{b.label}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.requiredHC}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.scheduledHC}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.presentHC}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.availableHC}</td>
                  <td className="px-4 py-3">
                    <Badge tone={gapTone(b.staffingGap)}>{b.staffingGap >= 0 ? `+${b.staffingGap}` : b.staffingGap}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={gapTone(b.availableStaffingGap)}>{b.availableStaffingGap >= 0 ? `+${b.availableStaffingGap}` : b.availableStaffingGap}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.offeredCalls}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.answeredCalls}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.abandonedCalls}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.ahtSeconds ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.serviceLevelPct != null ? `${b.serviceLevelPct}%` : "—"}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{b.occupancyPct != null ? `${b.occupancyPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
