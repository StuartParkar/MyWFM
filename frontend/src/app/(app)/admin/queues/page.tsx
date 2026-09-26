"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface QueueRow {
  id: number;
  code: string;
  name: string;
  processId: number | null;
  processName: string | null;
}

interface ProcessOption {
  id: number;
  code: string;
  name: string;
}

export default function QueuesPage() {
  const { authFetch } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<QueueRow[]>> => {
    try {
      const res = await authFetch("/api/master-data/queues");
      const body = (await res.json()) as ApiResponse<QueueRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: queues, error, loading, reload } = useAsyncResource(fetcher);

  const processesFetcher = useCallback(async (): Promise<AsyncResult<ProcessOption[]>> => {
    try {
      const res = await authFetch("/api/master-data/processes");
      const body = (await res.json()) as ApiResponse<ProcessOption[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: processes } = useAsyncResource(processesFetcher);

  async function handleSetProcess(queueId: number, value: string) {
    await authFetch(`/api/master-data/queues/${queueId}/process`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processId: value ? Number(value) : null }),
    });
    reload();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const res = await authFetch("/api/master-data/queues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not add queue.");
      return;
    }
    setCode("");
    setName("");
    reload();
  }

  async function handleRemove(id: number) {
    await authFetch(`/api/master-data/queues/${id}`, { method: "PATCH" });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Queues</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Queue master data. Assign each queue&rsquo;s Process below to attribute its real call
          volume to a roster requirement&rsquo;s Required Productive HC/Capacity/Occupancy (build
          spec section 19) - a queue created by a Calls import starts with no Process, since
          nothing in a phone-system export says which process it belongs to.
        </p>
      </div>

      <Card>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Code</span>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-32 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-64 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <Button type="submit" disabled={submitting}>
            Add queue
          </Button>
          {formError && <span className="text-sm text-critical">{formError}</span>}
        </form>
      </Card>

      {loading && <LoadingState label="Loading queues" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && queues?.length === 0 && (
        <EmptyState
          title="No queues configured yet"
          description="Nothing invented here - add a real queue above once it's known (see documentation/phone-system-mapping.md)."
        />
      )}
      {!loading && !error && queues && queues.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Process</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink-muted">{q.code}</td>
                  <td className="px-4 py-3 text-ink">{q.name}</td>
                  <td className="px-4 py-3">
                    <select
                      value={q.processId ?? ""}
                      onChange={(e) => handleSetProcess(q.id, e.target.value)}
                      className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
                    >
                      <option value="">Unassigned</option>
                      {processes?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" onClick={() => handleRemove(q.id)}>
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
