import { beforeEach, describe, expect, it, vi } from "vitest";

const listPublishedRosterKeysByProcess = vi.fn();
const listPresentCountByProcess = vi.fn();
const listShrinkageMinutesByProcess = vi.fn();
vi.mock("../src/modules/staffing/staffing.repository.js", () => ({
  listPublishedRosterKeysByProcess,
  listPresentCountByProcess,
  listShrinkageMinutesByProcess,
}));

const listByProcess = vi.fn();
vi.mock("../src/modules/calls/callMetrics.service.js", () => ({ listByProcess }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

const { listCapacityByProcess } = await import("../src/modules/staffing/staffing.service.js");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

beforeEach(() => {
  listPublishedRosterKeysByProcess.mockReset();
  listPresentCountByProcess.mockReset();
  listShrinkageMinutesByProcess.mockReset();
  listByProcess.mockReset();
  recordCalculation.mockClear();
});

describe("listCapacityByProcess", () => {
  it("merges real scheduled hours, present HC, shrinkage minutes and call workload into Required Productive HC/Capacity/Capacity Utilization/Occupancy", async () => {
    listPublishedRosterKeysByProcess.mockResolvedValue([
      { employeeId: "e1", businessDate: "2026-09-25", processId: 10, processName: "Bookings", shiftId: 1, startTime: "09:00", endTime: "18:00", isOvernight: false, isWeeklyOff: false },
    ]);
    listPresentCountByProcess.mockResolvedValue([{ businessDate: "2026-09-25", processId: 10, presentHC: 1 }]);
    listShrinkageMinutesByProcess.mockResolvedValue([{ businessDate: "2026-09-25", processId: 10, shrinkageMinutes: 54 }]);
    listByProcess.mockResolvedValue([{ businessDate: "2026-09-25", processId: 10, processName: "Bookings", workloadHours: 3.6, offeredCalls: 40, answeredCalls: 36, abandonedCalls: 4, answerRatePct: 90, abandonRatePct: 10, ahtSeconds: 324, serviceLevelPct: 80 }]);

    const [row] = await listCapacityByProcess({ from: "2026-09-25", to: "2026-09-25" });

    // 9-hour shift -> 540 scheduled minutes; 54 shrinkage minutes -> 10% shrinkage.
    expect(row).toMatchObject({
      businessDate: "2026-09-25",
      processId: 10,
      scheduledHC: 1,
      presentHC: 1,
      scheduledHours: 9,
      shrinkagePct: 10,
      workloadHours: 3.6,
      capacityHours: round2(9 * 0.9), // 8.1
      requiredProductiveHC: round2(3.6 / (9 * 0.9)), // standard shift hours default = 9
      capacityUtilizationPct: round2((3.6 / (9 * 0.9)) * 100),
      occupancyPct: round2((3.6 / (1 * 9)) * 100),
    });
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "CAPACITY_HOURS", entityType: "Process", entityId: "10", computedValue: row!.capacityHours }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "REQUIRED_PRODUCTIVE_HC", computedValue: row!.requiredProductiveHC }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "OCCUPANCY_PCT", computedValue: row!.occupancyPct }));
  });

  it("reports null Capacity Utilization (not a divide-by-zero) when a process had call workload but nobody scheduled", async () => {
    listPublishedRosterKeysByProcess.mockResolvedValue([]);
    listPresentCountByProcess.mockResolvedValue([]);
    listShrinkageMinutesByProcess.mockResolvedValue([]);
    listByProcess.mockResolvedValue([{ businessDate: "2026-09-25", processId: 20, processName: "Support", workloadHours: 5, offeredCalls: 10, answeredCalls: 9, abandonedCalls: 1, answerRatePct: 90, abandonRatePct: 10, ahtSeconds: 1800, serviceLevelPct: 70 }]);

    const [row] = await listCapacityByProcess({ from: "2026-09-25", to: "2026-09-25" });

    expect(row).toMatchObject({ scheduledHC: 0, scheduledHours: 0, capacityHours: 0, capacityUtilizationPct: null, occupancyPct: null });
    expect(recordCalculation).not.toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "CAPACITY_UTILIZATION_PCT" }));
  });

  it("counts a weekly-off published-roster row toward Scheduled HC with zero scheduled hours, never a fabricated shift length", async () => {
    listPublishedRosterKeysByProcess.mockResolvedValue([
      { employeeId: "e1", businessDate: "2026-09-25", processId: 10, processName: "Bookings", shiftId: null, startTime: null, endTime: null, isOvernight: null, isWeeklyOff: true },
    ]);
    listPresentCountByProcess.mockResolvedValue([]);
    listShrinkageMinutesByProcess.mockResolvedValue([]);
    listByProcess.mockResolvedValue([]);

    const [row] = await listCapacityByProcess({ from: "2026-09-25", to: "2026-09-25" });

    expect(row).toMatchObject({ scheduledHC: 1, scheduledHours: 0, shrinkagePct: null, capacityHours: 0 });
  });
});
