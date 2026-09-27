"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface QueueIntervalCall {
  queueIntervalCallId: number;
  queueId: number | null;
  queueName: string | null;
  sourceQueueId: string;
  agentId: string | null;
  agentName: string | null;
  sourceAgentId: string | null;
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  sourceCallId: string | null;
  direction: string | null;
  waitSeconds: number | null;
  talkSeconds: number | null;
  holdSeconds: number | null;
  acwSeconds: number | null;
  handleSeconds: number | null;
  disposition: string | null;
}

interface AgentIntervalCall {
  agentIntervalCallId: number;
  agentId: string | null;
  agentName: string | null;
  sourceAgentId: string;
  queueId: number | null;
  queueName: string | null;
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  sourceCallId: string | null;
  direction: string | null;
  waitSeconds: number | null;
  talkSeconds: number | null;
  holdSeconds: number | null;
  acwSeconds: number | null;
  handleSeconds: number | null;
  disposition: string | null;
}

interface QueueLookup {
  id: number;
  code: string;
  name: string;
}

const DISPOSITION_TONE: Record<string, BadgeTone> = {
  ANSWERED: "success",
  CONNECTED: "success",
  ABANDONED: "critical",
  MISSED: "critical",
  NOT_CONNECTED: "critical",
  VOICEMAIL: "warning",
  FORWARDED: "info",
  OTHER: "neutral",
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function DispositionBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  return <Badge tone={DISPOSITION_TONE[value] ?? "neutral"}>{value}</Badge>;
}

export default function CallsPage() {
  const { authFetch } = useAuth();
  const [tab, setTab] = useState<"queue" | "agent">("queue");
  const [range, setRange] = useState(defaultRange);
  const [queueId, setQueueId] = useState("");
  const [agentCode, setAgentCode] = useState("");
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [agentFilterError, setAgentFilterError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const queuesFetcher = useCallback(async (): Promise<AsyncResult<QueueLookup[]>> => {
    try {
      const res = await authFetch("/api/master-data/queues");
      const body = (await res.json()) as ApiResponse<QueueLookup[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: queues } = useAsyncResource(queuesFetcher);

  async function applyAgentFilter() {
    setAgentFilterError(null);
    if (!agentCode.trim()) {
      setAgentId(undefined);
      setPage(1);
      return;
    }
    const res = await authFetch(`/api/master-data/employees?search=${encodeURIComponent(agentCode)}&pageSize=1`);
    const body = (await res.json()) as ApiResponse<{ items: { employeeId: string }[] }>;
    const id = body.success ? body.data.items[0]?.employeeId : undefined;
    if (!id) {
      setAgentFilterError(`No employee matches "${agentCode}".`);
      return;
    }
    setAgentId(id);
    setPage(1);
  }

  const queueFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<QueueIntervalCall> | null>> => {
    if (tab !== "queue") return { ok: true, data: null };
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: "25" });
      if (queueId) params.set("queueId", queueId);
      const res = await authFetch(`/api/calls/queue-intervals?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<QueueIntervalCall>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, tab, range, page, queueId]);
  const { data: queueResult, error: queueError, loading: queueLoading, reload: reloadQueue } = useAsyncResource(queueFetcher, [tab, range, page, queueId]);

  const agentFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<AgentIntervalCall> | null>> => {
    if (tab !== "agent") return { ok: true, data: null };
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: "25" });
      if (queueId) params.set("queueId", queueId);
      if (agentId) params.set("agentId", agentId);
      const res = await authFetch(`/api/calls/agent-intervals?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<AgentIntervalCall>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, tab, range, page, queueId, agentId]);
  const { data: agentResult, error: agentError, loading: agentLoading, reload: reloadAgent } = useAsyncResource(agentFetcher, [tab, range, page, queueId, agentId]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Calls</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The universal call model (build spec section 16) across Vonage, Elevate and RingCentral - one row per real
          call, at either queue grain or agent grain (see documentation/phone-system-mapping.md). The two grains are
          never summed together - switch tabs rather than expecting one combined total. Offered/answered/abandoned,
          AHT and other aggregates are computed at report time (Phase 7&rsquo;s Calculation Ledger), never stored
          here. Upload a phone-system export from Import Center to populate this screen.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <div className="flex gap-1 rounded-lg border border-line-strong p-1">
          <button
            type="button"
            onClick={() => {
              setTab("queue");
              setPage(1);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "queue" ? "bg-accent text-white" : "text-ink-muted hover:bg-canvas"}`}
          >
            Queue Intervals
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("agent");
              setPage(1);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "agent" ? "bg-accent text-white" : "text-ink-muted hover:bg-canvas"}`}
          >
            Agent Intervals
          </button>
        </div>
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
        <Select
          label="Queue (optional)"
          value={queueId}
          onChange={(e) => {
            setPage(1);
            setQueueId(e.target.value);
          }}
        >
          <option value="">All queues</option>
          {queues?.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </Select>
        {tab === "agent" && (
          <>
            <Input
              label="Agent Employee Code (optional)"
              className="w-48"
              value={agentCode}
              onChange={(e) => setAgentCode(e.target.value)}
            />
            <Button variant="secondary" onClick={applyAgentFilter}>
              Apply filter
            </Button>
            {agentFilterError && <span className="text-sm text-critical">{agentFilterError}</span>}
          </>
        )}
      </Card>

      {tab === "queue" && (
        <>
          {queueLoading && <LoadingState label="Loading queue intervals" />}
          {!queueLoading && queueError && <ErrorState message={queueError} onRetry={reloadQueue} />}
          {!queueLoading && !queueError && queueResult?.items.length === 0 && (
            <EmptyState
              title="Nothing to show"
              description="No queue-grain call in this range matches these filters yet. Upload a Vonage or Elevate export from Import Center to populate this screen."
            />
          )}
          {!queueLoading && !queueError && queueResult && queueResult.items.length > 0 && (
            <>
              <Card className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Start → End</th>
                      <th className="px-4 py-3 font-medium">Queue</th>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Direction</th>
                      <th className="px-4 py-3 font-medium">Disposition</th>
                      <th className="px-4 py-3 font-medium">Wait</th>
                      <th className="px-4 py-3 font-medium">Talk</th>
                      <th className="px-4 py-3 font-medium">Source Call Id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueResult.items.map((r) => (
                      <tr key={r.queueIntervalCallId} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 text-ink">{r.businessDate}</td>
                        <td className="px-4 py-3 text-ink-muted">
                          {fmtTime(r.intervalStart)} → {fmtTime(r.intervalEnd)}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{r.queueName ?? r.sourceQueueId}</td>
                        <td className="px-4 py-3 text-ink-muted">{r.agentName ?? r.sourceAgentId ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-muted">{r.direction ?? "—"}</td>
                        <td className="px-4 py-3">
                          <DispositionBadge value={r.disposition} />
                        </td>
                        <td className="px-4 py-3 text-ink-muted tabular-nums">{fmtDuration(r.waitSeconds)}</td>
                        <td className="px-4 py-3 text-ink-muted tabular-nums">{fmtDuration(r.talkSeconds)}</td>
                        <td className="px-4 py-3 text-ink-faint">{r.sourceCallId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <div className="flex items-center justify-between text-sm text-ink-muted">
                <span>
                  Page {queueResult.page} of {queueResult.totalPages} · {queueResult.totalItems} call(s)
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" disabled={page >= queueResult.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "agent" && (
        <>
          {agentLoading && <LoadingState label="Loading agent intervals" />}
          {!agentLoading && agentError && <ErrorState message={agentError} onRetry={reloadAgent} />}
          {!agentLoading && !agentError && agentResult?.items.length === 0 && (
            <EmptyState
              title="Nothing to show"
              description="No agent-grain call in this range matches these filters yet. Upload a Vonage Company Summary, Elevate or RingCentral export from Import Center to populate this screen."
            />
          )}
          {!agentLoading && !agentError && agentResult && agentResult.items.length > 0 && (
            <>
              <Card className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Start → End</th>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Queue</th>
                      <th className="px-4 py-3 font-medium">Direction</th>
                      <th className="px-4 py-3 font-medium">Disposition</th>
                      <th className="px-4 py-3 font-medium">Handle</th>
                      <th className="px-4 py-3 font-medium">Source Call Id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentResult.items.map((r) => (
                      <tr key={r.agentIntervalCallId} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 text-ink">{r.businessDate}</td>
                        <td className="px-4 py-3 text-ink-muted">
                          {fmtTime(r.intervalStart)} → {fmtTime(r.intervalEnd)}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">
                          <div className="flex items-center gap-2">
                            <span>{r.agentName ?? "—"}</span>
                            {!r.agentId && <Badge tone="warning">unresolved: {r.sourceAgentId}</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{r.queueName ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-muted">{r.direction ?? "—"}</td>
                        <td className="px-4 py-3">
                          <DispositionBadge value={r.disposition} />
                        </td>
                        <td className="px-4 py-3 text-ink-muted tabular-nums">{fmtDuration(r.handleSeconds)}</td>
                        <td className="px-4 py-3 text-ink-faint">{r.sourceCallId ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <div className="flex items-center justify-between text-sm text-ink-muted">
                <span>
                  Page {agentResult.page} of {agentResult.totalPages} · {agentResult.totalItems} call(s)
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" disabled={page >= agentResult.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
