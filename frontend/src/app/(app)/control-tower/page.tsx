"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFilters } from "@/lib/filters/FilterContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface Kpi {
  value: number | null;
  formulaCode: string | null;
}

interface ControlTowerSummary {
  plannedHC: Kpi;
  presentHC: Kpi;
  requiredHC: Kpi;
  staffingGap: Kpi;
  coveragePct: Kpi;
  calls: Kpi;
  ahtSeconds: Kpi;
  serviceLevelPct: Kpi;
  abandonRatePct: Kpi;
  occupancyPct: Kpi;
  shrinkagePct: Kpi;
  attendancePct: Kpi;
}

interface LedgerRow {
  calculationCode: string;
  formulaCode: string;
  formulaVersionLabel: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  computedValue: number;
  computedAt: string;
}

type KpiKey = keyof ControlTowerSummary;

const KPI_CONFIG: { key: KpiKey; label: string; format: (v: number) => string; group: "A" | "B" }[] = [
  { key: "plannedHC", label: "Planned HC", format: (v) => String(v), group: "A" },
  { key: "presentHC", label: "Present HC", format: (v) => String(v), group: "B" },
  { key: "requiredHC", label: "Required HC", format: (v) => String(v), group: "A" },
  { key: "staffingGap", label: "Staffing Gap", format: (v) => (v >= 0 ? `+${v}` : String(v)), group: "A" },
  { key: "coveragePct", label: "Coverage", format: (v) => `${v}%`, group: "A" },
  { key: "calls", label: "Calls", format: (v) => String(v), group: "A" },
  { key: "ahtSeconds", label: "AHT", format: (v) => `${v}s`, group: "A" },
  { key: "serviceLevelPct", label: "Service Level", format: (v) => `${v}%`, group: "A" },
  { key: "abandonRatePct", label: "Abandon Rate", format: (v) => `${v}%`, group: "A" },
  { key: "occupancyPct", label: "Occupancy", format: (v) => `${v}%`, group: "A" },
  { key: "shrinkagePct", label: "Shrinkage", format: (v) => `${v}%`, group: "B" },
  { key: "attendancePct", label: "Attendance", format: (v) => `${v}%`, group: "B" },
];

function KpiTile({ label, kpi, format, onExplain }: { label: string; kpi: Kpi; format: (v: number) => string; onExplain?: () => void }) {
  const explainable = kpi.formulaCode !== null && kpi.value !== null;
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold text-ink tabular-nums">{kpi.value == null ? "—" : format(kpi.value)}</span>
        </div>
        {explainable ? (
          <button type="button" onClick={onExplain} className="mt-1 text-xs font-medium text-accent hover:underline">
            Explain this number
          </button>
        ) : (
          <p className="mt-1 text-xs text-ink-faint">{kpi.value == null ? "No data in range" : "Real count - no formula to explain"}</p>
        )}
      </CardBody>
    </Card>
  );
}

export default function ControlTowerPage() {
  const { authFetch } = useAuth();
  const { filters } = useFilters();
  const [explainCode, setExplainCode] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<ControlTowerSummary>> => {
    try {
      const params = new URLSearchParams({ from: filters.dateRange.startDate, to: filters.dateRange.endDate });
      if (filters.process !== "ALL") params.set("processId", filters.process);
      if (filters.hod !== "ALL") params.set("hodId", filters.hod);
      if (filters.tl !== "ALL") params.set("tlId", filters.tl);
      if (filters.agentSenior !== "ALL") params.set("agentSeniorId", filters.agentSenior);
      if (filters.designation) params.set("designationCode", filters.designation);
      const res = await authFetch(`/api/control-tower/summary?${params}`);
      const body = (await res.json()) as ApiResponse<ControlTowerSummary>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, filters]);
  const { data: summary, error, loading, reload } = useAsyncResource(fetcher, [filters]);

  const ledgerFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<LedgerRow> | null>> => {
    if (!explainCode) return { ok: true, data: null };
    try {
      const params = new URLSearchParams({ formulaCode: explainCode, from: filters.dateRange.startDate, to: filters.dateRange.endDate, pageSize: "50" });
      const res = await authFetch(`/api/formulas/ledger?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<LedgerRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, explainCode, filters]);
  const { data: ledger, error: ledgerError, loading: ledgerLoading } = useAsyncResource(ledgerFetcher, [explainCode, filters]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Control Tower</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {filters.dateRange.startDate === filters.dateRange.endDate ? `Business date: ${filters.dateRange.startDate}` : `Range: ${filters.dateRange.startDate} → ${filters.dateRange.endDate}`}
          {" · "}Designation: {filters.designation}. Present HC/Attendance/Shrinkage respect the full HOD/TL/Agent-Senior/Designation cascade above; every other card is
          company-wide (Process + date range only) - a roster requirement or a call queue isn&rsquo;t &ldquo;for&rdquo; one employee, so filtering either by an individual doesn&rsquo;t have a
          well-defined meaning (see documentation/controltower.md).
        </p>
      </div>

      {loading && <LoadingState label="Loading Control Tower" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {KPI_CONFIG.map(({ key, label, format }) => (
            <KpiTile key={key} label={label} kpi={summary[key]} format={format} onExplain={() => setExplainCode(summary[key].formulaCode)} />
          ))}
        </div>
      )}

      {explainCode && (
        <Card>
          <CardHeader title={`Explain This Number · ${explainCode}`} subtitle="Every Calculation Ledger entry this formula wrote in the current date range." action={<Button variant="ghost" onClick={() => setExplainCode(null)}>Close</Button>} />
          <CardBody className="flex flex-col gap-3">
            {ledgerLoading && <LoadingState label="Loading ledger entries" />}
            {!ledgerLoading && ledgerError && <ErrorState message={ledgerError} />}
            {!ledgerLoading && !ledgerError && ledger?.items.length === 0 && (
              <EmptyState title="No ledger entries" description="This formula hasn't been computed for anything in the current range yet." />
            )}
            {!ledgerLoading && !ledgerError && ledger && ledger.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2 font-medium">Calc</th>
                      <th className="px-4 py-2 font-medium">Version</th>
                      <th className="px-4 py-2 font-medium">Entity</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium">Value</th>
                      <th className="px-4 py-2 font-medium">Computed At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.items.map((row) => (
                      <tr key={row.calculationCode} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-ink-faint">{row.calculationCode}</td>
                        <td className="px-4 py-2 text-ink-muted">{row.formulaVersionLabel}</td>
                        <td className="px-4 py-2 text-ink-muted">{row.entityType} #{row.entityId}</td>
                        <td className="px-4 py-2 text-ink">{row.businessDate}</td>
                        <td className="px-4 py-2 text-ink tabular-nums">{row.computedValue}</td>
                        <td className="px-4 py-2 text-ink-faint">{new Date(row.computedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
