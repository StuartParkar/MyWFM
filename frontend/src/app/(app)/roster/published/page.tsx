"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface PublishedRosterRow {
  publishedRosterId: number;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  shiftCode: string | null;
  version: number;
}

const PAGE_SIZE = 50;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  return { from: toIsoDate(today), to: toIsoDate(end) };
}

export default function PublishedRosterPage() {
  const { authFetch } = useAuth();
  const [range, setRange] = useState(defaultRange);
  const [page, setPage] = useState(1);

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<PublishedRosterRow>>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: String(PAGE_SIZE) });
      const res = await authFetch(`/api/roster/published?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<PublishedRosterRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, page]);

  const { data: result, error, loading, reload } = useAsyncResource(fetcher, [range, page]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Published Roster</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The official, versioned roster. Each row is the currently active version for that employee and business date -
          publishing a change deactivates the previous version rather than deleting it.
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

      {loading && <LoadingState label="Loading published roster" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="Nothing published for this range" description="Publish a roster requirement (WFM approval) to see rows here." />
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
                  <th className="px-4 py-3 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((r) => (
                  <tr key={r.publishedRosterId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink">{r.businessDate}</td>
                    <td className="px-4 py-3 text-ink-muted">{r.employeeName}</td>
                    <td className="px-4 py-3 text-ink-muted">{r.shiftCode ?? "—"}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">v{r.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>
              Page {result.page} of {result.totalPages} · {result.totalItems} published slots
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
