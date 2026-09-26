"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface HolidayRow {
  id: number;
  holidayDate: string;
  holidayName: string;
  locationId: number | null;
  locationName: string | null;
}

export default function HolidaysPage() {
  const { authFetch } = useAuth();
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<HolidayRow[]>> => {
    try {
      const res = await authFetch("/api/master-data/holidays");
      const body = (await res.json()) as ApiResponse<HolidayRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: holidays, error, loading, reload } = useAsyncResource(fetcher);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const res = await authFetch("/api/master-data/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holidayDate, holidayName }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not add holiday.");
      return;
    }
    setHolidayDate("");
    setHolidayName("");
    reload();
  }

  async function handleRemove(id: number) {
    await authFetch(`/api/master-data/holidays/${id}`, { method: "PATCH" });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Holidays</h1>
        <p className="mt-1 text-sm text-ink-muted">Holiday and operating-day calendar, referenced by the forecast engine (Phase 7).</p>
      </div>

      <Card>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Date</span>
            <input
              type="date"
              required
              value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Name</span>
            <input
              type="text"
              required
              placeholder="e.g. Diwali"
              value={holidayName}
              onChange={(e) => setHolidayName(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <Button type="submit" disabled={submitting}>
            Add holiday
          </Button>
          {formError && <span className="text-sm text-critical">{formError}</span>}
        </form>
      </Card>

      {loading && <LoadingState label="Loading holidays" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && holidays?.length === 0 && (
        <EmptyState title="No holidays configured yet" description="Add the business's real holiday calendar above - nothing is pre-filled." />
      )}
      {!loading && !error && holidays && holidays.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">{h.holidayDate}</td>
                  <td className="px-4 py-3 text-ink">{h.holidayName}</td>
                  <td className="px-4 py-3 text-ink-muted">{h.locationName ?? "All locations"}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" onClick={() => handleRemove(h.id)}>
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
