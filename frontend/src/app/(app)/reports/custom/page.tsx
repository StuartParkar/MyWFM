"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface FormulaDefinition {
  formulaCode: string;
  name: string;
  category: string;
}

interface LedgerRow {
  calculationLedgerId: number;
  calculationCode: string;
  formulaVersionLabel: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  computedValue: number;
  sourceReference: string | null;
  computedAt: string;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

export default function CustomReportsPage() {
  const { authFetch } = useAuth();
  const [range, setRange] = useState(defaultRange);
  const [formulaCode, setFormulaCode] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [page, setPage] = useState(1);

  const formulasFetcher = useCallback(async (): Promise<AsyncResult<FormulaDefinition[]>> => {
    try {
      const res = await authFetch("/api/formulas");
      const body = (await res.json()) as ApiResponse<FormulaDefinition[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: formulas } = useAsyncResource(formulasFetcher);

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<LedgerRow>>> => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: "50" });
      if (formulaCode) params.set("formulaCode", formulaCode);
      if (entityType) params.set("entityType", entityType);
      if (entityId) params.set("entityId", entityId);
      const res = await authFetch(`/api/formulas/ledger?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<LedgerRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, range, formulaCode, entityType, entityId, page]);
  const { data: result, error, loading, reload } = useAsyncResource(fetcher, [range, formulaCode, entityType, entityId, page]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Custom Reports</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ad-hoc querying against the Calculation Ledger - every real value any formula has ever produced, filterable
          by formula, entity type/id and date range together (build spec section 24). There is no separate
          &ldquo;save report&rdquo; feature yet - the filters below are reflected in nothing but this page&rsquo;s own
          state today, so bookmark or share the exact combination you want by re-selecting it. For a simpler,
          formula-only browse, see Admin &gt; Formula Library.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">From</span>
          <input type="date" value={range.from} onChange={(e) => { setPage(1); setRange((r) => ({ ...r, from: e.target.value })); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">To</span>
          <input type="date" value={range.to} onChange={(e) => { setPage(1); setRange((r) => ({ ...r, to: e.target.value })); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Formula</span>
          <select value={formulaCode} onChange={(e) => { setPage(1); setFormulaCode(e.target.value); }} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink">
            <option value="">All formulas</option>
            {formulas?.map((f) => (
              <option key={f.formulaCode} value={f.formulaCode}>
                {f.name} ({f.category})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Entity Type</span>
          <input value={entityType} onChange={(e) => { setPage(1); setEntityType(e.target.value); }} placeholder="e.g. Process, Queue" className="w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Entity Id</span>
          <input value={entityId} onChange={(e) => { setPage(1); setEntityId(e.target.value); }} className="w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink" />
        </label>
      </Card>

      {loading && <LoadingState label="Loading ledger entries" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="No ledger entries match these filters" description="Widen the date range or clear a filter - values only appear once a screen has actually computed something matching them." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3 font-medium">Calculation</th>
                  <th className="px-4 py-3 font-medium">Formula</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Business Date</th>
                  <th className="px-4 py-3 font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Computed At</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row) => (
                  <tr key={row.calculationLedgerId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-ink-faint">{row.calculationCode}</td>
                    <td className="px-4 py-3 text-ink">{row.formulaVersionLabel}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.entityType} #{row.entityId}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.businessDate}</td>
                    <td className="px-4 py-3 text-ink tabular-nums">{row.computedValue}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.sourceReference ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-faint">{new Date(row.computedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>Page {result.page} of {result.totalPages} · {result.totalItems} entries</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
