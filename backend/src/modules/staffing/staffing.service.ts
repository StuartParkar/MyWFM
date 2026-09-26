import type { PaginatedResult } from "@mywfm/shared";
import { recordCalculation } from "../formula/calculationLedger.js";
import * as repo from "./staffing.repository.js";

export interface StaffingCoverageSummary extends repo.RequirementCoverageRow {
  rosterCoveragePct: number | null;
  staffingGap: number;
  actualStaffingGap: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listCoverage(params: {
  from: string;
  to: string;
  departmentId?: number;
  processId?: number;
  page: number;
  pageSize: number;
  computedByUserId?: string;
}): Promise<PaginatedResult<StaffingCoverageSummary>> {
  const result = await repo.listPublishedRequirementCoverage(params);

  const items = await Promise.all(
    result.items.map(async (row) => {
      const rosterCoveragePct = row.requiredHc > 0 ? round2((row.scheduledHc / row.requiredHc) * 100) : null;
      const staffingGap = row.scheduledHc - row.requiredHc;
      const actualStaffingGap = row.presentHc - row.requiredHc;
      const entityId = String(row.rosterRequirementId);
      const inputsSnapshot = { requiredHc: row.requiredHc, scheduledHc: row.scheduledHc, presentHc: row.presentHc };

      await Promise.all([
        rosterCoveragePct !== null
          ? recordCalculation({
              formulaCode: "ROSTER_COVERAGE_PCT",
              formulaVersion: 1,
              entityType: "RosterRequirement",
              entityId,
              businessDate: row.businessDate,
              computedValue: rosterCoveragePct,
              inputsSnapshot,
              computedByUserId: params.computedByUserId ?? null,
            })
          : Promise.resolve(),
        recordCalculation({
          formulaCode: "STAFFING_GAP",
          formulaVersion: 1,
          entityType: "RosterRequirement",
          entityId,
          businessDate: row.businessDate,
          computedValue: staffingGap,
          inputsSnapshot,
          computedByUserId: params.computedByUserId ?? null,
        }),
        recordCalculation({
          formulaCode: "ACTUAL_STAFFING_GAP",
          formulaVersion: 1,
          entityType: "RosterRequirement",
          entityId,
          businessDate: row.businessDate,
          computedValue: actualStaffingGap,
          inputsSnapshot,
          computedByUserId: params.computedByUserId ?? null,
        }),
      ]);

      return { ...row, rosterCoveragePct, staffingGap, actualStaffingGap };
    }),
  );

  return { ...result, items };
}
