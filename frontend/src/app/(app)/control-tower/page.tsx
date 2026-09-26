"use client";

import { useFilters } from "@/lib/filters/FilterContext";
import { KpiCard } from "@/components/ui/KpiCard";
import { EmptyState } from "@/components/ui/States";

const PLANNED_KPIS = [
  "Planned HC",
  "Present HC",
  "Required HC",
  "Staffing Gap",
  "Calls",
  "AHT",
  "Service Level",
  "Abandon Rate",
  "Occupancy",
  "Shrinkage",
  "Attendance",
  "Coverage",
] as const;

export default function ControlTowerPage() {
  const { filters } = useFilters();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Control Tower</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {filters.dateRange.startDate === filters.dateRange.endDate
            ? `Business date: ${filters.dateRange.startDate}`
            : `Range: ${filters.dateRange.startDate} → ${filters.dateRange.endDate}`}
          {" · "}Designation: {filters.designation}
        </p>
      </div>

      {/*
        No calculation engine or fact data exists yet (those are Phase 6-8) -
        build spec section 79 rules out hard-coded/fake KPI values, so every
        card below shows its real, honest state instead of an invented number.
      */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {PLANNED_KPIS.map((label) => (
          <KpiCard key={label} label={label} value="—" hint="Awaiting data source" />
        ))}
      </div>

      <EmptyState
        title="No data sources connected yet"
        description="The Control Tower renders from the deterministic Calculation Engine and Calculation Ledger (Phase 7-8), fed by Roster, Attendance and Calls imports (Phase 3-6). Once those phases land, this screen fills in - it will never show an invented number before then."
      />
    </div>
  );
}
