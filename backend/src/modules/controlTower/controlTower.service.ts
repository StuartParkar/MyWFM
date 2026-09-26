import { getConfigNumber, getConfigString } from "../../config/appConfig.js";
import { computeScheduledWindow } from "../attendance/attendance.service.js";
import { listPresentCountByProcess } from "../staffing/staffing.repository.js";
import { recordCalculation } from "../formula/calculationLedger.js";
import * as repo from "./controlTower.repository.js";
import type { ControlTowerFilters } from "./controlTower.repository.js";

/** `formulaCode: null` means this card is a raw count of real rows (Planned/Present/Required
 * HC, Calls) - self-explanatory as-is, and deliberately not ledger-logged (matches the "raw
 * counts aren't their own ledger entries" precedent from callMetrics/staffing). Every other
 * card is a derived ratio and does carry a formulaCode - "Explain This Number" drills into
 * GET /api/formulas/ledger?formulaCode=...&from=...&to=... for those. */
export interface ControlTowerKpi {
  value: number | null;
  formulaCode: string | null;
}

export interface ControlTowerSummary {
  plannedHC: ControlTowerKpi;
  presentHC: ControlTowerKpi;
  requiredHC: ControlTowerKpi;
  staffingGap: ControlTowerKpi;
  coveragePct: ControlTowerKpi;
  calls: ControlTowerKpi;
  ahtSeconds: ControlTowerKpi;
  serviceLevelPct: ControlTowerKpi;
  abandonRatePct: ControlTowerKpi;
  occupancyPct: ControlTowerKpi;
  shrinkagePct: ControlTowerKpi;
  attendancePct: ControlTowerKpi;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getSummary(filters: ControlTowerFilters & { computedByUserId?: string }): Promise<ControlTowerSummary> {
  const standardShiftHours = getConfigNumber("staffing.standard_shift_hours", 9);
  const serviceLevelThresholdSeconds = getConfigNumber("calls.service_level_threshold_seconds", 20);
  const tz = getConfigString("business_day.timezone", "Asia/Kolkata");

  const [rosterAgg, callsAgg, scheduleRows, presentByProcessDay] = await Promise.all([
    repo.getRosterAggregate({ from: filters.from, to: filters.to, processId: filters.processId }),
    repo.getCallsAggregate({ from: filters.from, to: filters.to, processId: filters.processId, serviceLevelThresholdSeconds }),
    repo.listScheduledEmployees(filters),
    listPresentCountByProcess({ from: filters.from, to: filters.to, processId: filters.processId }),
  ]);

  // Group B (Present HC / Attendance % / Shrinkage %): the full HOD/TL/Agent-Senior/
  // Designation/Process cascade genuinely applies, since these are per-employee questions.
  const plannedHCFiltered = scheduleRows.length;
  const presentHCFiltered = scheduleRows.filter((r) => r.isPresent).length;
  let scheduledMinutes = 0;
  for (const r of scheduleRows) scheduledMinutes += (computeScheduledWindow(r, tz).scheduledHours ?? 0) * 60;
  const employeeIds = [...new Set(scheduleRows.map((r) => r.employeeId))];
  const shrinkageMinutes = await repo.getShrinkageMinutesForEmployees({ from: filters.from, to: filters.to, employeeIds });
  const shrinkagePct = scheduledMinutes > 0 ? round2((shrinkageMinutes / scheduledMinutes) * 100) : null;
  const attendancePct = plannedHCFiltered > 0 ? round2((presentHCFiltered / plannedHCFiltered) * 100) : null;

  // Group A (Planned/Required HC, Staffing Gap, Coverage %, Calls, AHT, Service Level,
  // Abandon Rate): Process + Date only - a roster requirement and a call queue aren't "for"
  // one employee, so the HOD/TL/Agent-Senior/Designation cascade has no well-defined meaning
  // here. See documentation/controltower.md.
  const staffingGap = rosterAgg.scheduledHC - rosterAgg.requiredHC;
  const coveragePct = rosterAgg.requiredHC > 0 ? round2((rosterAgg.scheduledHC / rosterAgg.requiredHC) * 100) : null;
  const ahtSeconds = callsAgg.answeredCalls > 0 ? round2(callsAgg.answeredHandleSecondsSum / callsAgg.answeredCalls) : null;
  const abandonRatePct = callsAgg.offeredCalls > 0 ? round2((callsAgg.abandonedCalls / callsAgg.offeredCalls) * 100) : null;
  const serviceLevelPct = callsAgg.offeredCalls > 0 ? round2((callsAgg.answeredWithinThreshold / callsAgg.offeredCalls) * 100) : null;
  const workloadHours = round2((callsAgg.offeredCalls * (ahtSeconds ?? 0)) / 3600);
  const presentPersonDays = presentByProcessDay.reduce((sum, r) => sum + r.presentHC, 0);
  const occupancyPct = presentPersonDays > 0 ? round2((workloadHours / (presentPersonDays * standardShiftHours)) * 100) : null;

  const entityType = filters.processId ? "Process" : "Company";
  const entityId = filters.processId ? String(filters.processId) : "ALL";
  const businessDate = filters.to;
  const inputsSnapshot = { from: filters.from, to: filters.to, processId: filters.processId ?? null, hodId: filters.hodId ?? null, tlId: filters.tlId ?? null, agentSeniorId: filters.agentSeniorId ?? null, designationCode: filters.designationCode ?? null };
  const record = (formulaCode: string, computedValue: number | null) => {
    if (computedValue === null) return Promise.resolve();
    return recordCalculation({ formulaCode, formulaVersion: 1, entityType, entityId, businessDate, computedValue, inputsSnapshot, computedByUserId: filters.computedByUserId ?? null });
  };
  await Promise.all([
    record("STAFFING_GAP", staffingGap),
    record("ROSTER_COVERAGE_PCT", coveragePct),
    record("AHT_SECONDS", ahtSeconds),
    record("SERVICE_LEVEL_PCT", serviceLevelPct),
    record("ABANDON_RATE_PCT", abandonRatePct),
    record("OCCUPANCY_PCT", occupancyPct),
    record("SHRINKAGE_PCT", shrinkagePct),
    record("ATTENDANCE_PCT", attendancePct),
  ]);

  return {
    plannedHC: { value: rosterAgg.scheduledHC, formulaCode: null },
    presentHC: { value: presentHCFiltered, formulaCode: null },
    requiredHC: { value: rosterAgg.requiredHC, formulaCode: null },
    staffingGap: { value: staffingGap, formulaCode: "STAFFING_GAP" },
    coveragePct: { value: coveragePct, formulaCode: "ROSTER_COVERAGE_PCT" },
    calls: { value: callsAgg.offeredCalls, formulaCode: null },
    ahtSeconds: { value: ahtSeconds, formulaCode: "AHT_SECONDS" },
    serviceLevelPct: { value: serviceLevelPct, formulaCode: "SERVICE_LEVEL_PCT" },
    abandonRatePct: { value: abandonRatePct, formulaCode: "ABANDON_RATE_PCT" },
    occupancyPct: { value: occupancyPct, formulaCode: "OCCUPANCY_PCT" },
    shrinkagePct: { value: shrinkagePct, formulaCode: "SHRINKAGE_PCT" },
    attendancePct: { value: attendancePct, formulaCode: "ATTENDANCE_PCT" },
  };
}
