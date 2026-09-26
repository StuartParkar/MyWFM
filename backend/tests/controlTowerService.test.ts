import { beforeEach, describe, expect, it, vi } from "vitest";

const getRosterAggregate = vi.fn();
const getCallsAggregate = vi.fn();
const listScheduledEmployees = vi.fn();
const getShrinkageMinutesForEmployees = vi.fn();
vi.mock("../src/modules/controlTower/controlTower.repository.js", () => ({
  getRosterAggregate,
  getCallsAggregate,
  listScheduledEmployees,
  getShrinkageMinutesForEmployees,
}));

const listPresentCountByProcess = vi.fn();
vi.mock("../src/modules/staffing/staffing.repository.js", () => ({ listPresentCountByProcess }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

const { getSummary } = await import("../src/modules/controlTower/controlTower.service.js");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

beforeEach(() => {
  getRosterAggregate.mockReset();
  getCallsAggregate.mockReset();
  listScheduledEmployees.mockReset();
  getShrinkageMinutesForEmployees.mockReset();
  listPresentCountByProcess.mockReset();
  recordCalculation.mockClear();
});

describe("getSummary", () => {
  it("computes all 12 KPIs, applying the employee-hierarchy filter only to Present HC/Attendance %/Shrinkage %", async () => {
    getRosterAggregate.mockResolvedValue({ requiredHC: 10, scheduledHC: 8 });
    getCallsAggregate.mockResolvedValue({ offeredCalls: 100, answeredCalls: 80, abandonedCalls: 20, answeredHandleSecondsSum: 80 * 300, answeredWithinThreshold: 60 });
    // Two employees scheduled a 9-hour shift each on the same day; only one is present.
    listScheduledEmployees.mockResolvedValue([
      { employeeId: "e1", businessDate: "2026-09-25", shiftId: 1, startTime: "09:00", endTime: "18:00", isOvernight: false, isWeeklyOff: false, isPresent: true },
      { employeeId: "e2", businessDate: "2026-09-25", shiftId: 1, startTime: "09:00", endTime: "18:00", isOvernight: false, isWeeklyOff: false, isPresent: false },
    ]);
    getShrinkageMinutesForEmployees.mockResolvedValue(108); // 10% of 1080 total scheduled minutes (2 x 540)
    listPresentCountByProcess.mockResolvedValue([{ businessDate: "2026-09-25", processId: 10, presentHC: 5 }]);

    const result = await getSummary({ from: "2026-09-25", to: "2026-09-25" });

    expect(result.plannedHC).toEqual({ value: 8, formulaCode: null });
    expect(result.requiredHC).toEqual({ value: 10, formulaCode: null });
    expect(result.staffingGap).toEqual({ value: -2, formulaCode: "STAFFING_GAP" });
    expect(result.coveragePct).toEqual({ value: 80, formulaCode: "ROSTER_COVERAGE_PCT" });
    expect(result.calls).toEqual({ value: 100, formulaCode: null });
    expect(result.ahtSeconds).toEqual({ value: 300, formulaCode: "AHT_SECONDS" });
    expect(result.serviceLevelPct).toEqual({ value: 60, formulaCode: "SERVICE_LEVEL_PCT" });
    expect(result.abandonRatePct).toEqual({ value: 20, formulaCode: "ABANDON_RATE_PCT" });

    // Present HC / Attendance % / Shrinkage % come from the hierarchy-filtered employee set
    // (2 scheduled, 1 present), not the Group A roster aggregate (8 scheduled company-wide).
    expect(result.presentHC).toEqual({ value: 1, formulaCode: null });
    expect(result.attendancePct).toEqual({ value: 50, formulaCode: "ATTENDANCE_PCT" }); // 1/2 * 100
    expect(result.shrinkagePct).toEqual({ value: 10, formulaCode: "SHRINKAGE_PCT" }); // 108 / 1080 * 100

    // Occupancy uses Workload (100 offered x 300s AHT / 3600 = 8.33... hrs) against the
    // Group-A (process-wide, unfiltered) present-person-days of 5, not the filtered 1.
    const workloadHours = round2((100 * 300) / 3600);
    expect(result.occupancyPct.value).toBe(round2((workloadHours / (5 * 9)) * 100));

    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "STAFFING_GAP", entityType: "Company", entityId: "ALL", computedValue: -2 }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ATTENDANCE_PCT", computedValue: 50 }));
    expect(recordCalculation).not.toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "STAFFING_GAP", entityType: "Process" }));
  });

  it("scopes ledger entries to the filtered Process when one is given, rather than Company", async () => {
    getRosterAggregate.mockResolvedValue({ requiredHC: 0, scheduledHC: 0 });
    getCallsAggregate.mockResolvedValue({ offeredCalls: 0, answeredCalls: 0, abandonedCalls: 0, answeredHandleSecondsSum: 0, answeredWithinThreshold: 0 });
    listScheduledEmployees.mockResolvedValue([]);
    getShrinkageMinutesForEmployees.mockResolvedValue(0);
    listPresentCountByProcess.mockResolvedValue([]);

    await getSummary({ from: "2026-09-25", to: "2026-09-25", processId: 42 });

    // requiredHC = 0 means coveragePct/staffingGap-as-a-ledger-entry is still written (gap is
    // plain subtraction, never null) but scoped to that Process, not Company.
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "STAFFING_GAP", entityType: "Process", entityId: "42" }));
  });

  it("reports null percentages (not a divide-by-zero) when there is nothing scheduled/offered/present in range", async () => {
    getRosterAggregate.mockResolvedValue({ requiredHC: 0, scheduledHC: 0 });
    getCallsAggregate.mockResolvedValue({ offeredCalls: 0, answeredCalls: 0, abandonedCalls: 0, answeredHandleSecondsSum: 0, answeredWithinThreshold: 0 });
    listScheduledEmployees.mockResolvedValue([]);
    getShrinkageMinutesForEmployees.mockResolvedValue(0);
    listPresentCountByProcess.mockResolvedValue([]);

    const result = await getSummary({ from: "2026-09-25", to: "2026-09-25" });

    expect(result.coveragePct.value).toBeNull();
    expect(result.ahtSeconds.value).toBeNull();
    expect(result.serviceLevelPct.value).toBeNull();
    expect(result.abandonRatePct.value).toBeNull();
    expect(result.occupancyPct.value).toBeNull();
    expect(result.shrinkagePct.value).toBeNull();
    expect(result.attendancePct.value).toBeNull();
    expect(result.staffingGap.value).toBe(0); // plain subtraction always reports a real value
  });
});
