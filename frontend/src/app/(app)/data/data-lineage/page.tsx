"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface SourceImportRun {
  importRunId: number;
  importCode: string;
  sourceSystem: string;
  fileName: string;
  status: string;
  uploadedAt: string;
}

interface CalculationLineage {
  calculationLedgerId: number;
  calculationCode: string;
  formulaCode: string;
  formulaVersionLabel: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  computedValue: number;
  sourceReference: string | null;
  computedAt: string;
  inputsSnapshot: unknown;
  sourceImportRuns: SourceImportRun[];
}

/** Accepts either a raw id or the CALC-00000042 display code, whichever the user has on hand -
 * a "View lineage" link elsewhere in the app passes the id; a person reading a screen and typing
 * what they see would have the code. */
function parseCalculationId(input: string): number | null {
  const match = input.trim().match(/^(?:CALC-)?0*(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function initialIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("id") ?? "";
}

export default function DataLineagePage() {
  const { authFetch } = useAuth();
  const [input, setInput] = useState(initialIdFromUrl);
  const [lookupId, setLookupId] = useState<number | null>(() => parseCalculationId(initialIdFromUrl()));

  const fetcher = useCallback(async (): Promise<AsyncResult<CalculationLineage | null>> => {
    if (lookupId === null) return { ok: true, data: null };
    try {
      const res = await authFetch(`/api/formulas/ledger/${lookupId}`);
      const body = (await res.json()) as ApiResponse<CalculationLineage>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, lookupId]);
  const { data: lineage, error, loading } = useAsyncResource(fetcher, [lookupId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLookupId(parseCalculationId(input));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Data Lineage</h1>
        <p className="mt-1 text-sm text-ink-muted">
          KPI → calculation → formula version → normalized inputs → import → original file (build spec section 23) -
          look up any Calculation Ledger entry (a <code>CALC-00000001</code>-style code, from Custom Reports, Control
          Tower&rsquo;s &ldquo;Explain this number&rdquo;, or any other screen) to see exactly what produced it.
        </p>
      </div>

      <Card className="px-5 py-4">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">Calculation code or id</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="CALC-00000042"
              className="w-56 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <Button type="submit">Look up</Button>
        </form>
      </Card>

      {lookupId === null && input.trim().length > 0 && (
        <ErrorState message={`"${input}" isn't a recognized calculation code or id.`} />
      )}
      {loading && <LoadingState label="Loading lineage" />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && lookupId !== null && lineage && (
        <>
          <Card>
            <CardHeader title={lineage.calculationCode} subtitle={lineage.formulaVersionLabel} />
            <CardBody className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Entity</p>
                <p className="text-sm text-ink">{lineage.entityType} #{lineage.entityId}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Business Date</p>
                <p className="text-sm text-ink tabular-nums">{lineage.businessDate}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Computed Value</p>
                <p className="text-sm text-ink tabular-nums">{lineage.computedValue}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Computed At</p>
                <p className="text-sm text-ink">{new Date(lineage.computedAt).toLocaleString()}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Normalized inputs" subtitle="The exact snapshot this formula version computed from - formula.CalculationLedger.InputsSnapshot." />
            <CardBody>
              <pre className="overflow-x-auto rounded-md bg-canvas p-3 text-xs text-ink">{JSON.stringify(lineage.inputsSnapshot, null, 2)}</pre>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Source import" />
            <CardBody>
              {lineage.sourceImportRuns.length === 0 ? (
                <EmptyState
                  title="Not computed from a specific import run"
                  description="This formula is computed from live/manually entered data (roster, attendance, employee master data), not a specific uploaded file - so there is honestly nothing further to trace here. See documentation/formulas.md."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {lineage.sourceImportRuns.map((run) => (
                    <div key={run.importRunId} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
                      <span className="font-medium text-ink">{run.importCode}</span>
                      <Badge tone={run.status === "COMPLETED" ? "success" : run.status === "FAILED" ? "critical" : "neutral"}>{run.status}</Badge>
                      <span className="text-sm text-ink-muted">{run.sourceSystem} · {run.fileName}</span>
                      <span className="text-xs text-ink-faint">uploaded {new Date(run.uploadedAt).toLocaleString()}</span>
                    </div>
                  ))}
                  {lineage.sourceReference?.includes("+") && (
                    <p className="text-xs text-ink-faint">Source Reference was truncated ({lineage.sourceReference}) - more import runs fed this bucket than fit in the stored reference.</p>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
