"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface ShiftRow {
  id: number;
  code: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
}

export default function ShiftsPage() {
  const { authFetch } = useAuth();
  const [shiftCode, setShiftCode] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<ShiftRow[]>> => {
    try {
      const res = await authFetch("/api/master-data/shifts");
      const body = (await res.json()) as ApiResponse<ShiftRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: shifts, error, loading, reload } = useAsyncResource(fetcher);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const res = await authFetch("/api/master-data/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftCode, startTime, endTime }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not add shift.");
      return;
    }
    setShiftCode("");
    setStartTime("");
    setEndTime("");
    reload();
  }

  async function handleRemove(id: number) {
    await authFetch(`/api/master-data/shifts/${id}`, { method: "PATCH" });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Shifts</h1>
        <p className="mt-1 text-sm text-ink-muted">Shift master data, used by the roster workflow (Phase 4) and Business Day Engine (Phase 5).</p>
      </div>

      <Card>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 p-4">
          <Input label="Code" type="text" required placeholder="e.g. 17-02" className="w-28" value={shiftCode} onChange={(e) => setShiftCode(e.target.value)} />
          <Input label="Start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="End" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          <Button type="submit" loading={submitting}>
            Add shift
          </Button>
          {formError && <span className="text-sm text-critical">{formError}</span>}
        </form>
      </Card>

      {loading && <LoadingState label="Loading shifts" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && shifts?.length === 0 && (
        <EmptyState title="No shifts configured yet" description="Add the business's real shift patterns above - nothing invented." />
      )}
      {!loading && !error && shifts && shifts.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">End</th>
                <th className="px-4 py-3 font-medium">Overnight</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink-muted">{s.code}</td>
                  <td className="px-4 py-3 text-ink">{s.startTime}</td>
                  <td className="px-4 py-3 text-ink">{s.endTime}</td>
                  <td className="px-4 py-3">{s.isOvernight && <Badge tone="info">Overnight</Badge>}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" onClick={() => handleRemove(s.id)}>
                      Remove
                    </Button>
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
