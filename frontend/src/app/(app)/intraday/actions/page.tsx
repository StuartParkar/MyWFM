"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

type ExceptionStatus = "DETECTED" | "ACKNOWLEDGED" | "ACTION_TAKEN" | "RESOLVED";
type ExceptionCategory = "STAFFING" | "SERVICE_LEVEL" | "ATTENDANCE" | "DATA_QUALITY";

interface ExceptionRow {
  exceptionId: number;
  ruleCode: string;
  category: ExceptionCategory;
  ruleDescription: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  observedValue: number;
  thresholdValue: number;
  status: ExceptionStatus;
  detectedAt: string;
  acknowledgedByName: string | null;
  actionTaken: string | null;
  actionByName: string | null;
}

const STATUS_TONE: Record<ExceptionStatus, BadgeTone> = { DETECTED: "critical", ACKNOWLEDGED: "warning", ACTION_TAKEN: "info", RESOLVED: "success" };

export default function ActionsPage() {
  const { authFetch } = useAuth();
  const [category, setCategory] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [actionDraft, setActionDraft] = useState<{ id: number; text: string } | null>(null);
  const [resolveDraft, setResolveDraft] = useState<{ id: number; text: string } | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<ExceptionRow[]>> => {
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (showResolved) params.set("status", "RESOLVED");
      else params.set("excludeResolved", "true");
      const res = await authFetch(`/api/intraday/exceptions?${params}`);
      const body = (await res.json()) as ApiResponse<ExceptionRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, category, showResolved]);
  const { data: rows, error, loading, reload } = useAsyncResource(fetcher, [category, showResolved]);

  async function acknowledge(id: number) {
    setBusyId(id);
    setRowError(null);
    const res = await authFetch(`/api/intraday/exceptions/${id}/acknowledge`, { method: "PATCH" });
    setBusyId(null);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError({ id, message: !body.success ? body.error.message : "Could not acknowledge." });
      return;
    }
    reload();
  }

  async function submitAction(id: number) {
    const text = actionDraft?.id === id ? actionDraft.text.trim() : "";
    if (!text) {
      setRowError({ id, message: "Describe the action taken." });
      return;
    }
    setBusyId(id);
    setRowError(null);
    const res = await authFetch(`/api/intraday/exceptions/${id}/action`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionTaken: text }),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError({ id, message: !body.success ? body.error.message : "Could not record the action." });
      return;
    }
    setActionDraft(null);
    reload();
  }

  async function submitResolve(id: number) {
    const text = resolveDraft?.id === id ? resolveDraft.text.trim() : "";
    setBusyId(id);
    setRowError(null);
    const res = await authFetch(`/api/intraday/exceptions/${id}/resolve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionNotes: text || null }),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError({ id, message: !body.success ? body.error.message : "Could not resolve." });
      return;
    }
    setResolveDraft(null);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Actions</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The WFM action tracker (build spec section 20): every exception moves detected -&gt; acknowledged -&gt;
          action taken -&gt; resolved, in that order, each step attributed to whoever did it. Use Exceptions to run
          a scan for new breaches - this is the work queue for what is already open.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All categories</option>
            <option value="STAFFING">Staffing</option>
            <option value="SERVICE_LEVEL">Service Level</option>
            <option value="ATTENDANCE">Attendance</option>
            <option value="DATA_QUALITY">Data Quality</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved history instead of the open queue
        </label>
      </Card>

      {loading && <LoadingState label="Loading actions" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && rows?.length === 0 && (
        <EmptyState title={showResolved ? "Nothing resolved yet" : "Nothing open"} description={showResolved ? "No exceptions have been resolved for this filter yet." : "No open exceptions for this filter - run a scan on the Exceptions page."} />
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.exceptionId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{r.ruleCode}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{r.ruleDescription}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {r.entityType} #{r.entityId} - {r.businessDate} - observed {r.observedValue} vs threshold {r.thresholdValue}
                  </p>
                  {r.acknowledgedByName && <p className="mt-1 text-xs text-ink-faint">Acknowledged by {r.acknowledgedByName}</p>}
                  {r.actionTaken && (
                    <p className="mt-1 text-xs text-ink-faint">
                      Action by {r.actionByName}: {r.actionTaken}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {r.status === "DETECTED" && (
                    <Button variant="secondary" onClick={() => acknowledge(r.exceptionId)} disabled={busyId === r.exceptionId}>
                      {busyId === r.exceptionId ? "Acknowledging..." : "Acknowledge"}
                    </Button>
                  )}
                  {r.status === "ACKNOWLEDGED" &&
                    (actionDraft?.id === r.exceptionId ? (
                      <div className="flex flex-col items-end gap-2">
                        <textarea
                          value={actionDraft.text}
                          onChange={(e) => setActionDraft({ id: r.exceptionId, text: e.target.value })}
                          placeholder="What action was taken?"
                          className="w-64 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={() => setActionDraft(null)}>
                            Cancel
                          </Button>
                          <Button onClick={() => submitAction(r.exceptionId)} disabled={busyId === r.exceptionId}>
                            {busyId === r.exceptionId ? "Saving..." : "Save action"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => setActionDraft({ id: r.exceptionId, text: "" })}>
                        Record action
                      </Button>
                    ))}
                  {r.status === "ACTION_TAKEN" &&
                    (resolveDraft?.id === r.exceptionId ? (
                      <div className="flex flex-col items-end gap-2">
                        <textarea
                          value={resolveDraft.text}
                          onChange={(e) => setResolveDraft({ id: r.exceptionId, text: e.target.value })}
                          placeholder="Resolution notes (optional)"
                          className="w-64 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={() => setResolveDraft(null)}>
                            Cancel
                          </Button>
                          <Button onClick={() => submitResolve(r.exceptionId)} disabled={busyId === r.exceptionId}>
                            {busyId === r.exceptionId ? "Resolving..." : "Resolve"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => setResolveDraft({ id: r.exceptionId, text: "" })}>
                        Resolve
                      </Button>
                    ))}
                </div>
              </div>
              {rowError?.id === r.exceptionId && <p className="mt-2 text-sm text-critical">{rowError.message}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
