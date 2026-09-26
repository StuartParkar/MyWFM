"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface ScenarioRow {
  scenarioId: number;
  scenarioName: string;
  processId: number | null;
  processName: string | null;
  baselineFrom: string;
  baselineTo: string;
  volumeChangePct: number;
  ahtChangePct: number;
  shrinkagePctOverride: number | null;
  hcChange: number;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  modifiedAt: string;
}

interface EvaluationSide {
  offeredCalls: number;
  ahtSeconds: number | null;
  shrinkagePct: number | null;
  scheduledHC: number;
}

interface Evaluation {
  scenario: ScenarioRow;
  baseline: EvaluationSide;
  projected: EvaluationSide & {
    workloadHours: number;
    requiredProductiveHC: number | null;
    capacityHours: number;
    capacityUtilizationPct: number | null;
    staffingGap: number | null;
  };
}

interface ProcessLookup {
  id: number;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  scenarioName: "",
  processId: "",
  baselineFrom: "",
  baselineTo: "",
  volumeChangePct: "0",
  ahtChangePct: "0",
  shrinkagePctOverride: "",
  hcChange: "0",
  notes: "",
};

function formToBody(form: typeof EMPTY_FORM) {
  return {
    scenarioName: form.scenarioName,
    processId: form.processId ? Number(form.processId) : null,
    baselineFrom: form.baselineFrom,
    baselineTo: form.baselineTo,
    volumeChangePct: Number(form.volumeChangePct) || 0,
    ahtChangePct: Number(form.ahtChangePct) || 0,
    shrinkagePctOverride: form.shrinkagePctOverride ? Number(form.shrinkagePctOverride) : null,
    hcChange: Number(form.hcChange) || 0,
    notes: form.notes || null,
  };
}

function EvaluationTable({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2 font-medium">Metric</th>
            <th className="px-4 py-2 font-medium">Baseline (real)</th>
            <th className="px-4 py-2 font-medium">Projected (hypothetical)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">Offered Calls</td>
            <td className="px-4 py-2 text-ink-muted tabular-nums">{evaluation.baseline.offeredCalls}</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.offeredCalls}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">AHT (seconds)</td>
            <td className="px-4 py-2 text-ink-muted tabular-nums">{evaluation.baseline.ahtSeconds ?? "—"}</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.ahtSeconds ?? "—"}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">Shrinkage %</td>
            <td className="px-4 py-2 text-ink-muted tabular-nums">{evaluation.baseline.shrinkagePct != null ? `${evaluation.baseline.shrinkagePct}%` : "—"}</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.shrinkagePct != null ? `${evaluation.projected.shrinkagePct}%` : "—"}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">Scheduled HC</td>
            <td className="px-4 py-2 text-ink-muted tabular-nums">{evaluation.baseline.scheduledHC}</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.scheduledHC}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">Workload Hours</td>
            <td className="px-4 py-2 text-ink-faint">—</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.workloadHours}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">Required Productive HC</td>
            <td className="px-4 py-2 text-ink-faint">—</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.requiredProductiveHC ?? "—"}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="px-4 py-2 text-ink">Capacity Utilization %</td>
            <td className="px-4 py-2 text-ink-faint">—</td>
            <td className="px-4 py-2 text-ink tabular-nums">{evaluation.projected.capacityUtilizationPct != null ? `${evaluation.projected.capacityUtilizationPct}%` : "—"}</td>
          </tr>
          <tr>
            <td className="px-4 py-2 text-ink font-medium">Staffing Gap</td>
            <td className="px-4 py-2 text-ink-faint">—</td>
            <td className="px-4 py-2 text-ink font-medium tabular-nums">{evaluation.projected.staffingGap ?? "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ScenariosPage() {
  const { authFetch } = useAuth();

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

  const listFetcher = useCallback(async (): Promise<AsyncResult<ScenarioRow[]>> => {
    try {
      const res = await authFetch("/api/workforce/scenarios");
      const body = (await res.json()) as ApiResponse<ScenarioRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: scenarios, error, loading, reload } = useAsyncResource(listFetcher);

  const [form, setForm] = useState(EMPTY_FORM);
  const [preview, setPreview] = useState<Evaluation | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedEvaluation, setExpandedEvaluation] = useState<Evaluation | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  async function runPreview(e: React.FormEvent) {
    e.preventDefault();
    setPreviewError(null);
    setPreview(null);
    if (!form.scenarioName || !form.baselineFrom || !form.baselineTo) {
      setPreviewError("Name and a baseline date range are required.");
      return;
    }
    setBusy(true);
    const res = await authFetch("/api/workforce/scenarios/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToBody(form)),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setPreviewError(!body.success ? body.error.message : "Could not preview the scenario.");
      return;
    }
    const body = (await res.json()) as ApiResponse<Evaluation>;
    if (body.success) setPreview(body.data);
  }

  async function saveScenario() {
    setSaveError(null);
    setBusy(true);
    const res = await authFetch("/api/workforce/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToBody(form)),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setSaveError(!body.success ? body.error.message : "Could not save the scenario.");
      return;
    }
    setForm(EMPTY_FORM);
    setPreview(null);
    reload();
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedEvaluation(null);
      return;
    }
    setExpandedId(id);
    setExpandedEvaluation(null);
    setExpandedError(null);
    setExpandedLoading(true);
    const res = await authFetch(`/api/workforce/scenarios/${id}/evaluate`);
    setExpandedLoading(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setExpandedError(!body.success ? body.error.message : "Could not evaluate.");
      return;
    }
    const body = (await res.json()) as ApiResponse<Evaluation>;
    if (body.success) setExpandedEvaluation(body.data);
  }

  async function removeScenario(id: number) {
    const res = await authFetch(`/api/workforce/scenarios/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (expandedId === id) setExpandedId(null);
      reload();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Scenarios</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What-if scenario planning (build spec section 20): volume/AHT/shrinkage/HC change
          assumptions against a real historical baseline period. Only these assumptions are ever
          saved - the projected numbers below are always computed fresh from today&rsquo;s real
          data plus your saved deltas, never stored or written to the Calculation Ledger, exactly
          like Intraday&rsquo;s OT/VTO capacity-impact preview (see documentation/workforce.md).
        </p>
      </div>

      <Card>
        <CardHeader title="Build a scenario" subtitle="Preview before saving - nothing is written until you save." />
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={runPreview} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Name</span>
              <input type="text" value={form.scenarioName} onChange={(e) => setForm((f) => ({ ...f, scenarioName: e.target.value }))} className="min-w-[10rem] rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Process</span>
              <select value={form.processId} onChange={(e) => setForm((f) => ({ ...f, processId: e.target.value }))} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
                <option value="">All processes</option>
                {processes?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Baseline from</span>
              <input type="date" value={form.baselineFrom} onChange={(e) => setForm((f) => ({ ...f, baselineFrom: e.target.value }))} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Baseline to</span>
              <input type="date" value={form.baselineTo} onChange={(e) => setForm((f) => ({ ...f, baselineTo: e.target.value }))} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Volume change %</span>
              <input type="number" step="1" value={form.volumeChangePct} onChange={(e) => setForm((f) => ({ ...f, volumeChangePct: e.target.value }))} className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">AHT change %</span>
              <input type="number" step="1" value={form.ahtChangePct} onChange={(e) => setForm((f) => ({ ...f, ahtChangePct: e.target.value }))} className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Shrinkage % override</span>
              <input type="number" step="1" placeholder="Use real" value={form.shrinkagePctOverride} onChange={(e) => setForm((f) => ({ ...f, shrinkagePctOverride: e.target.value }))} className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">HC change</span>
              <input type="number" step="1" value={form.hcChange} onChange={(e) => setForm((f) => ({ ...f, hcChange: e.target.value }))} className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-muted">Notes</span>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="min-w-[10rem] rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
            </label>
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "Working..." : "Preview"}
            </Button>
            <Button type="button" onClick={saveScenario} disabled={busy || !preview}>
              Save scenario
            </Button>
          </form>
          {previewError && <p className="text-sm text-critical">{previewError}</p>}
          {saveError && <p className="text-sm text-critical">{saveError}</p>}
          {preview && <EvaluationTable evaluation={preview} />}
        </CardBody>
      </Card>

      {loading && <LoadingState label="Loading scenarios" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && scenarios?.length === 0 && <EmptyState title="No saved scenarios" description="Preview one above, then save it." />}
      {!loading && !error && scenarios && scenarios.length > 0 && (
        <div className="flex flex-col gap-3">
          {scenarios.map((s) => (
            <Card key={s.scenarioId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{s.scenarioName}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {s.processName ?? "All processes"} - {s.baselineFrom} to {s.baselineTo} - Volume {s.volumeChangePct >= 0 ? "+" : ""}{s.volumeChangePct}%, AHT {s.ahtChangePct >= 0 ? "+" : ""}{s.ahtChangePct}%, HC {s.hcChange >= 0 ? "+" : ""}{s.hcChange}
                    {s.shrinkagePctOverride != null ? `, Shrinkage override ${s.shrinkagePctOverride}%` : ""}
                  </p>
                  {s.notes && <p className="mt-1 text-xs text-ink-faint">{s.notes}</p>}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => toggleExpand(s.scenarioId)}>
                    {expandedId === s.scenarioId ? "Hide" : "Evaluate"}
                  </Button>
                  <Button variant="ghost" onClick={() => removeScenario(s.scenarioId)}>
                    Delete
                  </Button>
                </div>
              </div>
              {expandedId === s.scenarioId && (
                <div className="mt-3">
                  {expandedLoading && <LoadingState label="Evaluating" />}
                  {!expandedLoading && expandedError && <p className="text-sm text-critical">{expandedError}</p>}
                  {!expandedLoading && expandedEvaluation && <EvaluationTable evaluation={expandedEvaluation} />}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
