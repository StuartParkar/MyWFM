"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface FormulaDefinition {
  formulaCode: string;
  version: number;
  name: string;
  description: string;
  category: string;
  effectiveFrom: string;
}

interface LedgerRow {
  calculationLedgerId: number;
  calculationCode: string;
  formulaCode: string;
  formulaVersion: number;
  formulaVersionLabel: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  computedValue: number;
  sourceReference: string | null;
  computedAt: string;
}

export default function FormulaLibraryPage() {
  const { authFetch } = useAuth();

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
  const { data: formulas, error, loading, reload } = useAsyncResource(formulasFetcher);

  const [formulaCodeFilter, setFormulaCodeFilter] = useState("");
  const [page, setPage] = useState(1);

  const ledgerFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<LedgerRow>>> => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (formulaCodeFilter) params.set("formulaCode", formulaCodeFilter);
      const res = await authFetch(`/api/formulas/ledger?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<LedgerRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, formulaCodeFilter, page]);
  const { data: ledger, error: ledgerError, loading: ledgerLoading, reload: reloadLedger } = useAsyncResource(ledgerFetcher, [formulaCodeFilter, page]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Formula Library</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every formula&apos;s current version, what it computes, and since when. The computation itself is reviewed
          TypeScript, not a runtime expression - this catalog is metadata, and the Calculation Ledger below is every
          value it has produced, kept even after a later recalculation.
        </p>
      </div>

      {loading && <LoadingState label="Loading formulas" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && formulas?.length === 0 && <EmptyState title="No formulas registered" description="Nothing in formula.FormulaDefinition yet." />}
      {!loading && !error && formulas && formulas.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {formulas.map((f) => (
            <Card key={f.formulaCode}>
              <CardHeader
                title={f.name}
                subtitle={`${f.formulaCode} · v${f.version} · effective ${f.effectiveFrom}`}
                action={<Badge tone="info">{f.category}</Badge>}
              />
              <CardBody>
                <p className="text-sm text-ink-muted">{f.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Calculation Ledger"
          subtitle="Every computed value, its formula version, and when it was computed - section 23's Data Lineage reads this table."
          action={
            <select
              value={formulaCodeFilter}
              onChange={(e) => {
                setPage(1);
                setFormulaCodeFilter(e.target.value);
              }}
              className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">All formulas</option>
              {formulas?.map((f) => (
                <option key={f.formulaCode} value={f.formulaCode}>
                  {f.name}
                </option>
              ))}
            </select>
          }
        />
        <CardBody className="flex flex-col gap-3">
          {ledgerLoading && <LoadingState label="Loading ledger" />}
          {!ledgerLoading && ledgerError && <ErrorState message={ledgerError} onRetry={reloadLedger} />}
          {!ledgerLoading && !ledgerError && ledger?.items.length === 0 && (
            <EmptyState title="Nothing computed yet" description="Values appear here once Shrinkage or Staffing screens compute something in this range." />
          )}
          {!ledgerLoading && !ledgerError && ledger && ledger.items.length > 0 && (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-2 py-2 font-medium">Calculation</th>
                    <th className="px-2 py-2 font-medium">Computed At</th>
                    <th className="px-2 py-2 font-medium">Formula</th>
                    <th className="px-2 py-2 font-medium">Entity</th>
                    <th className="px-2 py-2 font-medium">Business Date</th>
                    <th className="px-2 py-2 font-medium">Value</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.items.map((l) => (
                    <tr key={l.calculationLedgerId} className="border-b border-line last:border-0">
                      <td className="px-2 py-2 text-ink-faint">{l.calculationCode}</td>
                      <td className="px-2 py-2 text-ink-muted">{new Date(l.computedAt).toLocaleString()}</td>
                      <td className="px-2 py-2 text-ink">{l.formulaVersionLabel}</td>
                      <td className="px-2 py-2 text-ink-muted">
                        {l.entityType} #{l.entityId}
                      </td>
                      <td className="px-2 py-2 text-ink-muted">{l.businessDate}</td>
                      <td className="px-2 py-2 text-ink tabular-nums">{l.computedValue}</td>
                      <td className="px-2 py-2 text-ink-muted">{l.sourceReference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between text-sm text-ink-muted">
                <span>
                  Page {ledger.page} of {ledger.totalPages} · {ledger.totalItems} entries
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="secondary" disabled={page >= ledger.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
