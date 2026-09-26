import type { PaginatedResult } from "@mywfm/shared";
import { getConfigNumber, getConfigString } from "../../config/appConfig.js";
import { computeScheduledWindow } from "../attendance/attendance.service.js";
import { listByProcess as listCallMetricsByProcess } from "../calls/callMetrics.service.js";
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

export interface ProcessCapacitySummary {
  businessDate: string;
  processId: number;
  processName: string | null;
  scheduledHC: number;
  presentHC: number;
  scheduledHours: number;
  shrinkagePct: number | null;
  workloadHours: number;
  requiredProductiveHC: number | null;
  capacityHours: number;
  capacityUtilizationPct: number | null;
  occupancyPct: number | null;
}

/**
 * The workload-derived half of the Staffing Engine (build spec section 19), computed per
 * (BusinessDate, ProcessId) - a different grain from listCoverage's per-RosterRequirement rows
 * above, because call workload has no notion of an individual requirement's shift: one
 * process can have several shifts/requirements covering the same day, and the calls arriving
 * at its queues don't know which one answers them. See documentation/formulas.md.
 *
 * Capacity Hours uses each employee's *real* scheduled shift length (computeScheduledWindow) -
 * not an assumed shift length - since that's already known from the published roster.
 * Required Productive HC is different: it answers "how many agents, at a standard shift
 * length" would be needed, a hypothetical headcount question with no real per-agent value to
 * measure, so it uses the configurable staffing.standard_shift_hours. Occupancy also uses that
 * same configurable value (Present HC's real logged-in hours aren't wired in yet - see
 * documentation/formulas.md).
 */
export async function listCapacityByProcess(params: { from: string; to: string; processId?: number; computedByUserId?: string }): Promise<ProcessCapacitySummary[]> {
  const tz = getConfigString("business_day.timezone", "Asia/Kolkata");
  const standardShiftHours = getConfigNumber("staffing.standard_shift_hours", 9);

  const [scheduleKeys, presentRows, shrinkageRows, workloadRows] = await Promise.all([
    repo.listPublishedRosterKeysByProcess(params),
    repo.listPresentCountByProcess(params),
    repo.listShrinkageMinutesByProcess(params),
    listCallMetricsByProcess(params),
  ]);

  interface Bucket {
    businessDate: string;
    processId: number;
    processName: string | null;
    scheduledHC: number;
    scheduledHours: number;
    presentHC: number;
    shrinkageMinutes: number;
    workloadHours: number;
  }
  const buckets = new Map<string, Bucket>();
  const bucket = (businessDate: string, processId: number, processName: string | null): Bucket => {
    const key = `${businessDate}|${processId}`;
    let b = buckets.get(key);
    if (!b) {
      b = { businessDate, processId, processName, scheduledHC: 0, scheduledHours: 0, presentHC: 0, shrinkageMinutes: 0, workloadHours: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const key of scheduleKeys) {
    const b = bucket(key.businessDate, key.processId, key.processName);
    b.scheduledHC += 1;
    b.scheduledHours += computeScheduledWindow(key, tz).scheduledHours ?? 0;
  }
  for (const p of presentRows) bucket(p.businessDate, p.processId, null).presentHC = p.presentHC;
  for (const s of shrinkageRows) bucket(s.businessDate, s.processId, null).shrinkageMinutes = s.shrinkageMinutes;
  for (const w of workloadRows) bucket(w.businessDate, w.processId, w.processName).workloadHours = w.workloadHours;

  const rows = [...buckets.values()]
    .map((b): ProcessCapacitySummary => {
      const scheduledMinutes = b.scheduledHours * 60;
      const shrinkagePct = scheduledMinutes > 0 ? round2((b.shrinkageMinutes / scheduledMinutes) * 100) : null;
      const shrinkageFraction = (shrinkagePct ?? 0) / 100;
      const capacityHours = round2(b.scheduledHours * (1 - shrinkageFraction));
      const requiredDenominator = standardShiftHours * (1 - shrinkageFraction);
      const requiredProductiveHC = requiredDenominator > 0 ? round2(b.workloadHours / requiredDenominator) : null;
      const capacityUtilizationPct = capacityHours > 0 ? round2((b.workloadHours / capacityHours) * 100) : null;
      const occupancyPct = b.presentHC > 0 ? round2((b.workloadHours / (b.presentHC * standardShiftHours)) * 100) : null;
      return {
        businessDate: b.businessDate,
        processId: b.processId,
        processName: b.processName,
        scheduledHC: b.scheduledHC,
        presentHC: b.presentHC,
        scheduledHours: round2(b.scheduledHours),
        shrinkagePct,
        workloadHours: b.workloadHours,
        requiredProductiveHC,
        capacityHours,
        capacityUtilizationPct,
        occupancyPct,
      };
    })
    .sort((a, b) => (a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : 0));

  await Promise.all(
    rows.map((row) => {
      const entityId = String(row.processId);
      const inputsSnapshot = {
        scheduledHC: row.scheduledHC,
        presentHC: row.presentHC,
        scheduledHours: row.scheduledHours,
        shrinkagePct: row.shrinkagePct,
        workloadHours: row.workloadHours,
        standardShiftHours,
      };
      const writes: Promise<void>[] = [
        recordCalculation({ formulaCode: "CAPACITY_HOURS", formulaVersion: 1, entityType: "Process", entityId, businessDate: row.businessDate, computedValue: row.capacityHours, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }),
      ];
      if (row.requiredProductiveHC !== null) {
        writes.push(recordCalculation({ formulaCode: "REQUIRED_PRODUCTIVE_HC", formulaVersion: 1, entityType: "Process", entityId, businessDate: row.businessDate, computedValue: row.requiredProductiveHC, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }));
      }
      if (row.capacityUtilizationPct !== null) {
        writes.push(recordCalculation({ formulaCode: "CAPACITY_UTILIZATION_PCT", formulaVersion: 1, entityType: "Process", entityId, businessDate: row.businessDate, computedValue: row.capacityUtilizationPct, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }));
      }
      if (row.occupancyPct !== null) {
        writes.push(recordCalculation({ formulaCode: "OCCUPANCY_PCT", formulaVersion: 1, entityType: "Process", entityId, businessDate: row.businessDate, computedValue: row.occupancyPct, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }));
      }
      return Promise.all(writes);
    }),
  );

  return rows;
}
