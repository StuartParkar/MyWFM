import { recordAudit } from "../audit/audit.service.js";
import * as shrinkageService from "../shrinkage/shrinkage.service.js";
import * as staffingService from "../staffing/staffing.service.js";
import * as callMetricsService from "../calls/callMetrics.service.js";
import * as forecastService from "../forecast/forecast.service.js";
import * as attritionService from "../attrition/attrition.service.js";
import * as repo from "./reprocessing.repository.js";
import type { ReprocessRequest } from "./reprocessing.validation.js";

export interface ReprocessResult {
  itemsRecomputed: number;
}

/** A large enough page to cover "the whole requested range" without adding real pagination to a
 * screen whose point is triggering recomputation, not browsing results row by row. */
const RECOMPUTE_PAGE_SIZE = 1000;

/**
 * Re-invokes the real service function for the requested calculation type over the requested
 * scope - no new math, exactly what a normal page load of that screen already does (every one of
 * these writes fresh formula.CalculationLedger rows as a side effect - documentation/formulas.md).
 * What's new is that this is an explicit, authorized, reasoned, audited request rather than
 * incidental to someone viewing a report.
 */
async function dispatch(input: ReprocessRequest, computedByUserId: string): Promise<ReprocessResult> {
  switch (input.calculationType) {
    case "SHRINKAGE": {
      const result = await shrinkageService.listDailyShrinkage({ employeeId: input.employeeId, from: input.from, to: input.to, page: 1, pageSize: RECOMPUTE_PAGE_SIZE, computedByUserId });
      return { itemsRecomputed: result.items.length };
    }
    case "STAFFING_COVERAGE": {
      const result = await staffingService.listCoverage({ from: input.from, to: input.to, departmentId: input.departmentId, processId: input.processId, page: 1, pageSize: RECOMPUTE_PAGE_SIZE, computedByUserId });
      return { itemsRecomputed: result.items.length };
    }
    case "STAFFING_CAPACITY": {
      const rows = await staffingService.listCapacityByProcess({ from: input.from, to: input.to, processId: input.processId, computedByUserId });
      return { itemsRecomputed: rows.length };
    }
    case "CALLS_BY_QUEUE": {
      const rows = await callMetricsService.listByQueue({ from: input.from, to: input.to, queueId: input.queueId, computedByUserId });
      return { itemsRecomputed: rows.length };
    }
    case "CALLS_BY_PROCESS": {
      const rows = await callMetricsService.listByProcess({ from: input.from, to: input.to, processId: input.processId, computedByUserId });
      return { itemsRecomputed: rows.length };
    }
    case "FORECAST": {
      const rows = await forecastService.getForecast({ from: input.from, to: input.to, queueId: input.queueId, computedByUserId });
      return { itemsRecomputed: rows.length };
    }
    case "ATTRITION": {
      await attritionService.getSummary({ from: input.from, to: input.to, departmentId: input.departmentId, processId: input.processId, locationId: input.locationId, designationId: input.designationId, computedByUserId });
      return { itemsRecomputed: 1 };
    }
  }
}

/** Only the dimension filters that calculation type's own dispatch branch above actually reads - see reprocessing.validation.ts's per-variant shape. */
export function buildScope(input: ReprocessRequest): Record<string, number | string | null> {
  switch (input.calculationType) {
    case "SHRINKAGE":
      return { employeeId: input.employeeId ?? null };
    case "STAFFING_COVERAGE":
      return { departmentId: input.departmentId ?? null, processId: input.processId ?? null };
    case "STAFFING_CAPACITY":
      return { processId: input.processId ?? null };
    case "CALLS_BY_QUEUE":
      return { queueId: input.queueId ?? null };
    case "CALLS_BY_PROCESS":
      return { processId: input.processId ?? null };
    case "FORECAST":
      return { queueId: input.queueId ?? null };
    case "ATTRITION":
      return { departmentId: input.departmentId ?? null, processId: input.processId ?? null, locationId: input.locationId ?? null, designationId: input.designationId ?? null };
  }
}

export async function runReprocessing(input: ReprocessRequest, requestedByUserId: string): Promise<repo.ReprocessingRequestRow> {
  let status: "COMPLETED" | "FAILED" = "COMPLETED";
  let errorMessage: string | null = null;
  let result: ReprocessResult = { itemsRecomputed: 0 };
  try {
    result = await dispatch(input, requestedByUserId);
  } catch (err) {
    status = "FAILED";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const row = await repo.insertReprocessingRequest({
    calculationType: input.calculationType,
    from: input.from,
    to: input.to,
    scopeJson: JSON.stringify(buildScope(input)),
    reason: input.reason,
    requestedByUserId,
    status,
    resultSummary: status === "COMPLETED" ? result : null,
    errorMessage,
  });

  await recordAudit({
    entityType: "ReprocessingRequest",
    entityId: String(row.requestId),
    action: status,
    performedByUserId: requestedByUserId,
    reason: input.reason,
    after: { calculationType: input.calculationType, from: input.from, to: input.to, status, ...result },
  });

  return row;
}

export async function listReprocessingRequests(page: number, pageSize: number) {
  return repo.listReprocessingRequests(page, pageSize);
}
