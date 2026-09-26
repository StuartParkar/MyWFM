import { beforeEach, describe, expect, it, vi } from "vitest";

const createOrReplacePlan = vi.fn();
const listPlans = vi.fn();
const getCurrentHC = vi.fn();
const getScenario = vi.fn();
vi.mock("../src/modules/workforce/workforce.repository.js", () => ({
  createOrReplacePlan,
  listPlans,
  getCurrentHC,
  getScenario,
  listScenarios: vi.fn(),
}));

const listByProcess = vi.fn();
vi.mock("../src/modules/calls/callMetrics.service.js", () => ({ listByProcess }));

const listCapacityByProcess = vi.fn();
vi.mock("../src/modules/staffing/staffing.service.js", () => ({ listCapacityByProcess }));

const recordAudit = vi.fn(async () => undefined);
vi.mock("../src/modules/audit/audit.service.js", () => ({ recordAudit }));

vi.mock("../src/config/appConfig.js", () => ({
  getConfigNumber: (_key: string, fallback: number) => fallback,
  getConfigString: (_key: string, fallback: string) => fallback,
}));

const { submitPlan, listPlansWithProjection, evaluateScenario, previewScenario } = await import("../src/modules/workforce/workforce.service.js");
const { ValidationError, NotFoundError } = await import("../src/errors/AppError.js");

beforeEach(() => {
  createOrReplacePlan.mockReset();
  listPlans.mockReset();
  getCurrentHC.mockReset();
  getScenario.mockReset();
  listByProcess.mockReset();
  listCapacityByProcess.mockReset();
  recordAudit.mockClear();
});

const BASE_PLAN_INPUT = {
  businessMonth: "2026-11-01",
  departmentId: null,
  processId: 10,
  locationId: null,
  designationId: null,
  requiredHC: 50,
  plannedHiresHC: 5,
  plannedExitsHC: 2,
  notes: null,
  createdByUserId: "user-1",
};

describe("submitPlan", () => {
  it("rejects a plan with no dimension at all, rather than letting it silently mean company-wide", async () => {
    await expect(submitPlan({ ...BASE_PLAN_INPUT, processId: null })).rejects.toThrow(ValidationError);
    expect(createOrReplacePlan).not.toHaveBeenCalled();
  });

  it("creates a plan with at least one dimension set and audits it", async () => {
    createOrReplacePlan.mockResolvedValue(7);
    const id = await submitPlan(BASE_PLAN_INPUT);
    expect(id).toBe(7);
    expect(createOrReplacePlan).toHaveBeenCalledWith(BASE_PLAN_INPUT);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "WorkforcePlan", entityId: "7", action: "CREATE" }));
  });
});

describe("listPlansWithProjection", () => {
  it("computes Future HC as Current HC + this row's own planned hires - exits, and Hiring Gap as Required - Future", async () => {
    listPlans.mockResolvedValue([
      {
        workforcePlanId: 1,
        businessMonth: "2026-11-01",
        departmentId: null,
        departmentName: null,
        processId: 10,
        processName: "Bookings",
        locationId: null,
        locationName: null,
        designationId: null,
        designationName: null,
        requiredHC: 50,
        plannedHiresHC: 5,
        plannedExitsHC: 2,
        notes: null,
        version: 1,
        createdByName: "WFM User",
        createdAt: "2026-09-25T00:00:00.000Z",
      },
    ]);
    getCurrentHC.mockResolvedValue(40);

    const [row] = await listPlansWithProjection({});

    expect(getCurrentHC).toHaveBeenCalledWith({ departmentId: null, processId: 10, locationId: null, designationId: null });
    expect(row).toMatchObject({ currentHC: 40, futureHC: 43, hiringGap: 7 }); // 40 + 5 - 2 = 43; 50 - 43 = 7 still to hire
  });

  it("reports a negative Hiring Gap (over-planned relative to target) without treating it as an error", async () => {
    listPlans.mockResolvedValue([
      { workforcePlanId: 2, businessMonth: "2026-11-01", departmentId: null, departmentName: null, processId: 10, processName: "Bookings", locationId: null, locationName: null, designationId: null, designationName: null, requiredHC: 30, plannedHiresHC: 10, plannedExitsHC: 0, notes: null, version: 1, createdByName: "WFM User", createdAt: "2026-09-25T00:00:00.000Z" },
    ]);
    getCurrentHC.mockResolvedValue(25);

    const [row] = await listPlansWithProjection({});
    expect(row).toMatchObject({ currentHC: 25, futureHC: 35, hiringGap: -5 });
  });
});

const BASELINE_CALL_ROWS = [{ businessDate: "2026-09-25", processId: 10, processName: "Bookings", offeredCalls: 100, answeredCalls: 90, abandonedCalls: 10, answerRatePct: 90, abandonRatePct: 10, ahtSeconds: 300, serviceLevelPct: 80, workloadHours: 7.5 }];
const BASELINE_CAPACITY_ROWS = [{ businessDate: "2026-09-25", processId: 10, processName: "Bookings", scheduledHC: 10, presentHC: 9, scheduledHours: 90, shrinkagePct: 10, workloadHours: 7.5, requiredProductiveHC: 1, capacityHours: 81, capacityUtilizationPct: 10, occupancyPct: 10 }];

describe("evaluateScenario / previewScenario", () => {
  it("applies volume/AHT/shrinkage/HC deltas on top of the real baseline, never mutating the baseline itself", async () => {
    getScenario.mockResolvedValue({
      scenarioId: 5,
      scenarioName: "Peak season",
      processId: 10,
      processName: "Bookings",
      baselineFrom: "2026-09-25",
      baselineTo: "2026-09-25",
      volumeChangePct: 20, // +20%
      ahtChangePct: 10, // +10%
      shrinkagePctOverride: null,
      hcChange: 2,
      notes: null,
      createdByName: "WFM User",
      createdAt: "2026-09-25T00:00:00.000Z",
      modifiedAt: "2026-09-25T00:00:00.000Z",
    });
    listByProcess.mockResolvedValue(BASELINE_CALL_ROWS);
    listCapacityByProcess.mockResolvedValue(BASELINE_CAPACITY_ROWS);

    const result = await evaluateScenario(5);

    expect(result.baseline).toMatchObject({ offeredCalls: 100, ahtSeconds: 300, shrinkagePct: 10, scheduledHC: 10 });
    // 100 x 1.2 = 120 calls; 300 x 1.1 = 330s AHT; shrinkage unchanged (10%); HC 10 + 2 = 12.
    expect(result.projected.offeredCalls).toBe(120);
    expect(result.projected.ahtSeconds).toBe(330);
    expect(result.projected.shrinkagePct).toBe(10);
    expect(result.projected.scheduledHC).toBe(12);
    // Workload = 120 x 330 / 3600 = 11 hours.
    expect(result.projected.workloadHours).toBe(11);
  });

  it("throws NotFoundError for a scenario id that doesn't exist", async () => {
    getScenario.mockResolvedValue(null);
    await expect(evaluateScenario(999)).rejects.toThrow(NotFoundError);
  });

  it("previews an unsaved scenario's inputs identically, without requiring a saved id", async () => {
    listByProcess.mockResolvedValue(BASELINE_CALL_ROWS);
    listCapacityByProcess.mockResolvedValue(BASELINE_CAPACITY_ROWS);

    const result = await previewScenario({
      scenarioName: "Draft",
      processId: 10,
      baselineFrom: "2026-09-25",
      baselineTo: "2026-09-25",
      volumeChangePct: -10,
      ahtChangePct: 0,
      shrinkagePctOverride: 15,
      hcChange: 0,
      notes: null,
    });

    expect(result.projected.offeredCalls).toBe(90); // 100 x 0.9
    expect(result.projected.shrinkagePct).toBe(15); // explicit override wins over the real 10%
    expect(getScenario).not.toHaveBeenCalled();
  });

  it("reports null Required Productive HC/Capacity Utilization/Staffing Gap (not a divide-by-zero) at a 100% shrinkage override", async () => {
    listByProcess.mockResolvedValue(BASELINE_CALL_ROWS);
    listCapacityByProcess.mockResolvedValue(BASELINE_CAPACITY_ROWS);

    const result = await previewScenario({
      scenarioName: "Fully shrunk",
      processId: 10,
      baselineFrom: "2026-09-25",
      baselineTo: "2026-09-25",
      volumeChangePct: 0,
      ahtChangePct: 0,
      shrinkagePctOverride: 100,
      hcChange: 0,
      notes: null,
    });

    expect(result.projected.capacityHours).toBe(0);
    expect(result.projected.requiredProductiveHC).toBeNull();
    expect(result.projected.capacityUtilizationPct).toBeNull();
    expect(result.projected.staffingGap).toBeNull();
  });

  it("reports zero workload hours (not a fabricated AHT) when there is no answered-call history to derive AHT from", async () => {
    listByProcess.mockResolvedValue([{ ...BASELINE_CALL_ROWS[0], answeredCalls: 0, ahtSeconds: null }]);
    listCapacityByProcess.mockResolvedValue(BASELINE_CAPACITY_ROWS);

    const result = await previewScenario({
      scenarioName: "No history",
      processId: 10,
      baselineFrom: "2026-09-25",
      baselineTo: "2026-09-25",
      volumeChangePct: 0,
      ahtChangePct: 0,
      shrinkagePctOverride: null,
      hcChange: 0,
      notes: null,
    });

    expect(result.baseline.ahtSeconds).toBeNull();
    expect(result.projected.workloadHours).toBe(0);
  });
});
