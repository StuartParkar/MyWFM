import { beforeEach, describe, expect, it, vi } from "vitest";

const getScheduledWindowForEmployee = vi.fn();
const listRequirementWindows = vi.fn();
const listScheduledEmployeeWindows = vi.fn();
const listAttendanceWindows = vi.fn();
const listBreakWindows = vi.fn();
const listCallEvents = vi.fn();
vi.mock("../src/modules/intraday/intraday.repository.js", () => ({
  getScheduledWindowForEmployee,
  listRequirementWindows,
  listScheduledEmployeeWindows,
  listAttendanceWindows,
  listBreakWindows,
  listCallEvents,
}));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

vi.mock("../src/config/appConfig.js", () => ({
  getConfigString: (key: string, fallback: string) => (key === "business_day.timezone" ? "UTC" : fallback),
  getConfigNumber: (_key: string, fallback: number) => fallback,
}));

const { getCapacityImpact } = await import("../src/modules/intraday/intraday.service.js");
const { ValidationError } = await import("../src/errors/AppError.js");

beforeEach(() => {
  getScheduledWindowForEmployee.mockReset();
  listRequirementWindows.mockReset().mockResolvedValue([]);
  listScheduledEmployeeWindows.mockReset().mockResolvedValue([]);
  listAttendanceWindows.mockReset().mockResolvedValue([]);
  listBreakWindows.mockReset().mockResolvedValue([]);
  listCallEvents.mockReset().mockResolvedValue([]);
  recordCalculation.mockClear();
});

const REQUESTER_SCHEDULE = { processId: 10, shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false };

describe("getCapacityImpact", () => {
  it("previews a VTO (early release) request as a -1 HC delta on exactly the released buckets", async () => {
    getScheduledWindowForEmployee.mockResolvedValue(REQUESTER_SCHEDULE);
    // Required HC only exists for the last 2 hours of the shift (15:00-17:00) - before this
    // request, Staffing Gap there is 1 scheduled - 3 required = -2.
    listRequirementWindows.mockResolvedValue([{ requiredHC: 3, shiftId: 1, startTime: "15:00", endTime: "17:00", isOvernight: false }]);
    listScheduledEmployeeWindows.mockResolvedValue([{ employeeId: "e1", shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]);

    const buckets = await getCapacityImpact({ employeeId: "e1", businessDate: "2026-09-25", requestType: "VTO", hoursRequested: 2 });

    expect(buckets.map((b) => b.label)).toEqual(["15:00", "15:30", "16:00", "16:30"]);
    for (const b of buckets) expect(b).toMatchObject({ beforeStaffingGap: -2, afterStaffingGap: -3 });
  });

  it("previews an Overtime request as a +1 HC delta on exactly the added buckets, past the employee's normal end", async () => {
    getScheduledWindowForEmployee.mockResolvedValue(REQUESTER_SCHEDULE);
    listRequirementWindows.mockResolvedValue([]);
    listScheduledEmployeeWindows.mockResolvedValue([{ employeeId: "e1", shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]);

    const buckets = await getCapacityImpact({ employeeId: "e1", businessDate: "2026-09-25", requestType: "OVERTIME", hoursRequested: 1 });

    expect(buckets.map((b) => b.label)).toEqual(["17:00", "17:30"]);
    for (const b of buckets) expect(b).toMatchObject({ beforeStaffingGap: 0, afterStaffingGap: 1 });
  });

  it("rejects when the employee has no published schedule on this business date, rather than guessing one", async () => {
    getScheduledWindowForEmployee.mockResolvedValue(null);

    await expect(getCapacityImpact({ employeeId: "e1", businessDate: "2026-09-25", requestType: "VTO", hoursRequested: 1 })).rejects.toThrow(ValidationError);
  });
});
