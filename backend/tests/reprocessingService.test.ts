import { beforeEach, describe, expect, it, vi } from "vitest";

const listDailyShrinkage = vi.fn();
vi.mock("../src/modules/shrinkage/shrinkage.service.js", () => ({ listDailyShrinkage: (...args: unknown[]) => listDailyShrinkage(...args) }));

const listCoverage = vi.fn();
const listCapacityByProcess = vi.fn();
vi.mock("../src/modules/staffing/staffing.service.js", () => ({
  listCoverage: (...args: unknown[]) => listCoverage(...args),
  listCapacityByProcess: (...args: unknown[]) => listCapacityByProcess(...args),
}));

const listByQueue = vi.fn();
const listByProcess = vi.fn();
vi.mock("../src/modules/calls/callMetrics.service.js", () => ({
  listByQueue: (...args: unknown[]) => listByQueue(...args),
  listByProcess: (...args: unknown[]) => listByProcess(...args),
}));

const getForecast = vi.fn();
vi.mock("../src/modules/forecast/forecast.service.js", () => ({ getForecast: (...args: unknown[]) => getForecast(...args) }));

const getSummary = vi.fn();
vi.mock("../src/modules/attrition/attrition.service.js", () => ({ getSummary: (...args: unknown[]) => getSummary(...args) }));

const insertReprocessingRequest = vi.fn();
const listReprocessingRequests = vi.fn();
vi.mock("../src/modules/reprocessing/reprocessing.repository.js", () => ({
  insertReprocessingRequest: (...args: unknown[]) => insertReprocessingRequest(...args),
  listReprocessingRequests: (...args: unknown[]) => listReprocessingRequests(...args),
}));

const recordAudit = vi.fn(async () => undefined);
vi.mock("../src/modules/audit/audit.service.js", () => ({ recordAudit }));

const { runReprocessing, buildScope } = await import("../src/modules/reprocessing/reprocessing.service.js");

beforeEach(() => {
  listDailyShrinkage.mockReset();
  listCoverage.mockReset();
  listCapacityByProcess.mockReset();
  listByQueue.mockReset();
  listByProcess.mockReset();
  getForecast.mockReset();
  getSummary.mockReset();
  insertReprocessingRequest.mockReset().mockImplementation(async (input) => ({ requestId: 1, ...input, requestedByName: null, scope: JSON.parse(input.scopeJson) }));
  recordAudit.mockClear();
});

const REQUESTED_BY = "11111111-1111-1111-1111-111111111111";

describe("runReprocessing", () => {
  it("dispatches SHRINKAGE to shrinkageService.listDailyShrinkage and reports the real item count", async () => {
    listDailyShrinkage.mockResolvedValue({ items: [1, 2, 3], page: 1, pageSize: 1000, totalItems: 3, totalPages: 1 });

    const row = await runReprocessing({ calculationType: "SHRINKAGE", from: "2026-09-01", to: "2026-09-30", employeeId: "e1", reason: "Correction re-run" }, REQUESTED_BY);

    expect(listDailyShrinkage).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "e1", from: "2026-09-01", to: "2026-09-30", computedByUserId: REQUESTED_BY }));
    expect(row.status).toBe("COMPLETED");
    expect(insertReprocessingRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETED", resultSummary: { itemsRecomputed: 3 } }));
  });

  it("dispatches CALLS_BY_PROCESS to callMetricsService.listByProcess", async () => {
    listByProcess.mockResolvedValue([{ processId: 1 }, { processId: 2 }]);

    await runReprocessing({ calculationType: "CALLS_BY_PROCESS", from: "2026-09-01", to: "2026-09-07", processId: 5, reason: "Re-imported a corrected file" }, REQUESTED_BY);

    expect(listByProcess).toHaveBeenCalledWith(expect.objectContaining({ processId: 5, computedByUserId: REQUESTED_BY }));
    expect(insertReprocessingRequest).toHaveBeenCalledWith(expect.objectContaining({ resultSummary: { itemsRecomputed: 2 } }));
  });

  it("dispatches ATTRITION to attritionService.getSummary and counts it as a single recomputation", async () => {
    getSummary.mockResolvedValue({ openingHC: 10, closingHC: 9 });

    await runReprocessing({ calculationType: "ATTRITION", from: "2026-09-01", to: "2026-09-30", departmentId: 4, reason: "Manual Join/Left Date correction" }, REQUESTED_BY);

    expect(getSummary).toHaveBeenCalledWith(expect.objectContaining({ departmentId: 4 }));
    expect(insertReprocessingRequest).toHaveBeenCalledWith(expect.objectContaining({ resultSummary: { itemsRecomputed: 1 } }));
  });

  it("records a FAILED request (not a thrown error) when the underlying calculation throws, with the real error message", async () => {
    listByQueue.mockRejectedValue(new Error("SQL Server timeout"));

    const row = await runReprocessing({ calculationType: "CALLS_BY_QUEUE", from: "2026-09-01", to: "2026-09-07", reason: "Retry after timeout" }, REQUESTED_BY);

    expect(row.status).toBe("FAILED");
    expect(insertReprocessingRequest).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", resultSummary: null, errorMessage: "SQL Server timeout" }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "FAILED", reason: "Retry after timeout" }));
  });

  it("always records an audit entry with the request's own reason", async () => {
    listCapacityByProcess.mockResolvedValue([]);

    await runReprocessing({ calculationType: "STAFFING_CAPACITY", from: "2026-09-01", to: "2026-09-30", reason: "Quarterly re-check" }, REQUESTED_BY);

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "ReprocessingRequest", performedByUserId: REQUESTED_BY, reason: "Quarterly re-check" }));
  });
});

describe("buildScope", () => {
  it("keeps only the dimension filters each calculation type's dispatch branch actually reads", () => {
    expect(buildScope({ calculationType: "SHRINKAGE", from: "2026-09-01", to: "2026-09-30", employeeId: "e1", reason: "x" })).toEqual({ employeeId: "e1" });
    expect(buildScope({ calculationType: "STAFFING_COVERAGE", from: "2026-09-01", to: "2026-09-30", departmentId: 2, processId: 3, reason: "x" })).toEqual({ departmentId: 2, processId: 3 });
    expect(buildScope({ calculationType: "ATTRITION", from: "2026-09-01", to: "2026-09-30", locationId: 9, reason: "x" })).toEqual({ departmentId: null, processId: null, locationId: 9, designationId: null });
  });
});
