import { recordCalculation } from "../formula/calculationLedger.js";
import * as repo from "./attrition.repository.js";
import type { DimensionFilters } from "./attrition.repository.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface AttritionSummary {
  openingHC: number;
  closingHC: number;
  joiners: number;
  exits: number;
  transfers: number;
  attritionRatePct: number | null;
  /** Currently-active employees with no JoinDate at all - an honest caveat, not hidden (should
   * normally be 0 after migration 0014's backfill; see attrition.repository.ts). */
  employeesMissingJoinDate: number;
}

/**
 * Build spec section 22: Opening/Closing HC, Joiners, Exits, Transfers, Attrition Rate - see
 * documentation/attrition.md for exactly what "real" means here (system-observed join/exit
 * dates unless a real HR date was entered manually, and a genuine Department/Location/
 * primary-Process change log for Transfers). Only Attrition Rate is a derived ratio and gets a
 * Calculation Ledger row - the five raw counts follow the same "raw counts aren't their own
 * ledger entries" precedent as every other formula in this system.
 */
export async function getSummary(params: { from: string; to: string; computedByUserId?: string } & DimensionFilters): Promise<AttritionSummary> {
  const filters: DimensionFilters = { departmentId: params.departmentId, processId: params.processId, locationId: params.locationId, designationId: params.designationId };

  const [openingHC, closingHC, joiners, exits, transfers, employeesMissingJoinDate] = await Promise.all([
    repo.getHeadcountAsOf(params.from, false, filters),
    repo.getHeadcountAsOf(params.to, true, filters),
    repo.getJoinersCount(params.from, params.to, filters),
    repo.getExitsCount(params.from, params.to, filters),
    repo.getTransfersCount(params.from, params.to, filters),
    repo.countActiveEmployeesMissingJoinDate(),
  ]);

  const averageHC = (openingHC + closingHC) / 2;
  const attritionRatePct = averageHC > 0 ? round2((exits / averageHC) * 100) : null;

  if (attritionRatePct !== null) {
    const entityType = params.processId ? "Process" : params.departmentId ? "Department" : params.locationId ? "Location" : params.designationId ? "Designation" : "Company";
    const entityId = String(params.processId ?? params.departmentId ?? params.locationId ?? params.designationId ?? "ALL");
    await recordCalculation({
      formulaCode: "ATTRITION_RATE_PCT",
      formulaVersion: 1,
      entityType,
      entityId,
      businessDate: params.to,
      computedValue: attritionRatePct,
      inputsSnapshot: { openingHC, closingHC, joiners, exits, transfers },
      computedByUserId: params.computedByUserId ?? null,
    });
  }

  return { openingHC, closingHC, joiners, exits, transfers, attritionRatePct, employeesMissingJoinDate };
}

export async function listJoinersAndExits(params: { from: string; to: string } & DimensionFilters): Promise<repo.JoinerExitRow[]> {
  return repo.listJoinersAndExits(params.from, params.to, params);
}

export async function listTransfers(params: { from: string; to: string } & DimensionFilters): Promise<repo.TransferRow[]> {
  return repo.listTransfers(params.from, params.to, params);
}
