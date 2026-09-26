import { recordAudit } from "../audit/audit.service.js";
import { listByProcess as listCallMetricsByProcess } from "../calls/callMetrics.service.js";
import { getConfigNumber } from "../../config/appConfig.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { listCapacityByProcess } from "../staffing/staffing.service.js";
import * as repo from "./workforce.repository.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface WorkforcePlanProjection extends repo.WorkforcePlanRow {
  currentHC: number;
  futureHC: number;
  hiringGap: number;
}

/**
 * Future HC is stated cumulatively, not incrementally: each plan row's PlannedHiresHC/
 * PlannedExitsHC are "how many more hires/exits are expected between today and this row's own
 * month" (entered that way by the WFM), not a month-over-month delta needing reconciliation
 * against every earlier month's own plan for the same dimension key. This keeps each row
 * self-contained and avoids an ambiguous "which prior months count" question. See
 * documentation/workforce.md.
 */
export async function listPlansWithProjection(params: { from?: string; to?: string; departmentId?: number; processId?: number; locationId?: number; designationId?: number }): Promise<WorkforcePlanProjection[]> {
  const plans = await repo.listPlans(params);
  return Promise.all(
    plans.map(async (plan): Promise<WorkforcePlanProjection> => {
      const currentHC = await repo.getCurrentHC({ departmentId: plan.departmentId, processId: plan.processId, locationId: plan.locationId, designationId: plan.designationId });
      const futureHC = currentHC + plan.plannedHiresHC - plan.plannedExitsHC;
      return { ...plan, currentHC, futureHC, hiringGap: plan.requiredHC - futureHC };
    }),
  );
}

export async function submitPlan(input: repo.WorkforcePlanInput): Promise<number> {
  if (!input.departmentId && !input.processId && !input.locationId && !input.designationId) {
    throw new ValidationError("At least one of department, process, location or designation must be set - a plan with no dimension at all would silently mean \"the whole company,\" which is never what a real plan means here.");
  }
  const id = await repo.createOrReplacePlan(input);
  await recordAudit({ entityType: "WorkforcePlan", entityId: String(id), action: "CREATE", performedByUserId: input.createdByUserId, after: input });
  return id;
}

// ---------------------------------------------------------------------------
// Scenario Planning - "never touches live data": only the scenario's own INPUT assumptions are
// persisted (workforce.repository.ts); every number below is computed on read and returned, not
// written to any live table or the Calculation Ledger.
// ---------------------------------------------------------------------------

export interface ScenarioEvaluation {
  scenario: repo.ScenarioRow;
  baseline: {
    offeredCalls: number;
    ahtSeconds: number | null;
    shrinkagePct: number | null;
    scheduledHC: number;
  };
  projected: {
    offeredCalls: number;
    ahtSeconds: number | null;
    shrinkagePct: number | null;
    scheduledHC: number;
    workloadHours: number;
    requiredProductiveHC: number | null;
    capacityHours: number;
    capacityUtilizationPct: number | null;
    staffingGap: number | null;
  };
}

async function computeBaseline(processId: number | null, from: string, to: string) {
  const [callRows, capacityRows] = await Promise.all([
    listCallMetricsByProcess({ from, to, processId: processId ?? undefined }),
    listCapacityByProcess({ from, to, processId: processId ?? undefined }),
  ]);

  // Calls: sum raw counts over the period first, then compute AHT once - the same discipline
  // callMetrics.service.ts itself already applies per-process; here it's applied again across
  // whichever processes matched (all of them, when processId is null).
  let offeredCalls = 0;
  let answeredCalls = 0;
  let handleSecondsSum = 0;
  for (const row of callRows) {
    offeredCalls += row.offeredCalls;
    answeredCalls += row.answeredCalls;
    if (row.ahtSeconds !== null) handleSecondsSum += row.ahtSeconds * row.answeredCalls;
  }
  const ahtSeconds = answeredCalls > 0 ? round2(handleSecondsSum / answeredCalls) : null;

  // HC/shrinkage have no meaningful "sum across days" (a headcount doesn't add up across
  // dates) - a plain average of the real per-day rows is the representative baseline instead,
  // the same period-averaging Reports pages already use (e.g. Attendance Report's
  // avgNetWorkingHours).
  const scheduledHC = capacityRows.length > 0 ? Math.round(capacityRows.reduce((s, r) => s + r.scheduledHC, 0) / capacityRows.length) : 0;
  const shrinkageRows = capacityRows.filter((r) => r.shrinkagePct !== null);
  const shrinkagePct = shrinkageRows.length > 0 ? round2(shrinkageRows.reduce((s, r) => s + r.shrinkagePct!, 0) / shrinkageRows.length) : null;

  return { offeredCalls, ahtSeconds, shrinkagePct, scheduledHC };
}

export async function evaluateScenario(id: number): Promise<ScenarioEvaluation> {
  const scenario = await repo.getScenario(id);
  if (!scenario) throw new NotFoundError("Scenario not found.");
  return evaluateScenarioInputs(scenario, scenario);
}

/** Shared by the saved-scenario evaluator and the "preview before saving" endpoint - both apply
 * the exact same real-data-plus-deltas math, just against a not-yet-saved input in one case. */
async function evaluateScenarioInputs(scenario: repo.ScenarioRow, input: repo.ScenarioInput): Promise<ScenarioEvaluation> {
  const standardShiftHours = getConfigNumber("staffing.standard_shift_hours", 9);
  const baseline = await computeBaseline(input.processId, input.baselineFrom, input.baselineTo);

  const projectedOfferedCalls = Math.round(baseline.offeredCalls * (1 + input.volumeChangePct / 100));
  const projectedAht = baseline.ahtSeconds !== null ? round2(baseline.ahtSeconds * (1 + input.ahtChangePct / 100)) : null;
  const projectedShrinkagePct = input.shrinkagePctOverride ?? baseline.shrinkagePct;
  const projectedScheduledHC = Math.max(0, baseline.scheduledHC + input.hcChange);

  const workloadHours = round2((projectedOfferedCalls * (projectedAht ?? 0)) / 3600);
  const shrinkageFraction = (projectedShrinkagePct ?? 0) / 100;
  const requiredDenominator = standardShiftHours * (1 - shrinkageFraction);
  const requiredProductiveHC = requiredDenominator > 0 ? round2(workloadHours / requiredDenominator) : null;
  const capacityHours = round2(projectedScheduledHC * standardShiftHours * (1 - shrinkageFraction));
  const capacityUtilizationPct = capacityHours > 0 ? round2((workloadHours / capacityHours) * 100) : null;
  const staffingGap = requiredProductiveHC !== null ? round2(projectedScheduledHC - requiredProductiveHC) : null;

  return {
    scenario,
    baseline,
    projected: {
      offeredCalls: projectedOfferedCalls,
      ahtSeconds: projectedAht,
      shrinkagePct: projectedShrinkagePct,
      scheduledHC: projectedScheduledHC,
      workloadHours,
      requiredProductiveHC,
      capacityHours,
      capacityUtilizationPct,
      staffingGap,
    },
  };
}

export async function previewScenario(input: repo.ScenarioInput): Promise<ScenarioEvaluation> {
  const placeholder: repo.ScenarioRow = { ...input, scenarioId: 0, processName: null, createdByName: "", createdAt: "", modifiedAt: "" };
  return evaluateScenarioInputs(placeholder, input);
}

export async function createScenario(input: repo.ScenarioInput & { createdByUserId: string }): Promise<number> {
  const id = await repo.createScenario(input);
  await recordAudit({ entityType: "Scenario", entityId: String(id), action: "CREATE", performedByUserId: input.createdByUserId, after: input });
  return id;
}

export async function updateScenario(id: number, input: repo.ScenarioInput, performedByUserId: string): Promise<void> {
  const before = await repo.getScenario(id);
  if (!before) throw new NotFoundError("Scenario not found.");
  await repo.updateScenario(id, input);
  await recordAudit({ entityType: "Scenario", entityId: String(id), action: "ADJUST", performedByUserId, before, after: input });
}

export async function deleteScenario(id: number, performedByUserId: string): Promise<void> {
  const before = await repo.getScenario(id);
  if (!before) throw new NotFoundError("Scenario not found.");
  await repo.deleteScenario(id);
  await recordAudit({ entityType: "Scenario", entityId: String(id), action: "DELETE", performedByUserId, before });
}

export const listScenarios = repo.listScenarios;
