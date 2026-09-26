import { beforeEach, describe, expect, it, vi } from "vitest";

const listRequirementWindows = vi.fn();
const listScheduledEmployeeWindows = vi.fn();
const listAttendanceWindows = vi.fn();
const listBreakWindows = vi.fn();
const listCallEvents = vi.fn();
vi.mock("../src/modules/intraday/intraday.repository.js", () => ({
  listRequirementWindows,
  listScheduledEmployeeWindows,
  listAttendanceWindows,
  listBreakWindows,
  listCallEvents,
}));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

// Pinned to UTC (same technique as attendanceService.test.ts) so expected bucket instants are
// plain "businessDate + HH:MM" arithmetic, with no IST offset to carry through by hand.
vi.mock("../src/config/appConfig.js", () => ({
  getConfigString: (key: string, fallback: string) => (key === "business_day.timezone" ? "UTC" : fallback),
  getConfigNumber: (_key: string, fallback: number) => fallback,
}));

const { getIntervalSummary } = await import("../src/modules/intraday/intraday.service.js");

function findBucket(rows: Awaited<ReturnType<typeof getIntervalSummary>>, label: string) {
  const row = rows.find((r) => r.label === label);
  if (!row) throw new Error(`No bucket labeled "${label}" - available: ${rows.map((r) => r.label).join(", ")}`);
  return row;
}

beforeEach(() => {
  listRequirementWindows.mockReset();
  listScheduledEmployeeWindows.mockReset();
  listAttendanceWindows.mockReset();
  listBreakWindows.mockReset();
  listCallEvents.mockReset();
  recordCalculation.mockClear();
});

describe("getIntervalSummary", () => {
  it("buckets required/scheduled/present/available HC and staffing gap across a plain day shift", async () => {
    listRequirementWindows.mockResolvedValue([{ requiredHC: 5, shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false }]);
    listScheduledEmployeeWindows.mockResolvedValue([{ employeeId: "e1", shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]);
    listAttendanceWindows.mockResolvedValue([{ employeeId: "e1", sessionStart: "2026-09-25T09:00:00.000Z", sessionEnd: "2026-09-25T17:00:00.000Z" }]);
    listBreakWindows.mockResolvedValue([]);
    listCallEvents.mockResolvedValue([]);

    const rows = await getIntervalSummary({ businessDate: "2026-09-25" });

    const inShift = findBucket(rows, "09:00");
    expect(inShift).toMatchObject({ requiredHC: 5, scheduledHC: 1, presentHC: 1, availableHC: 1, staffingGap: -4, availableStaffingGap: -4 });

    const lastInShift = findBucket(rows, "16:30");
    expect(lastInShift).toMatchObject({ requiredHC: 5, scheduledHC: 1 });

    const beforeShift = findBucket(rows, "08:30");
    expect(beforeShift).toMatchObject({ requiredHC: 0, scheduledHC: 0, presentHC: 0 });

    // The shift's own end (17:00) is exclusive - the employee no longer counts there.
    const atShiftEnd = findBucket(rows, "17:00");
    expect(atShiftEnd).toMatchObject({ requiredHC: 0, scheduledHC: 0 });

    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "STAFFING_GAP", entityType: "CompanyInterval", computedValue: -4 }));
  });

  it("drops Available HC (but not Present HC) for exactly the buckets a recorded break covers", async () => {
    listRequirementWindows.mockResolvedValue([{ requiredHC: 1, shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false }]);
    listScheduledEmployeeWindows.mockResolvedValue([{ employeeId: "e1", shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]);
    listAttendanceWindows.mockResolvedValue([{ employeeId: "e1", sessionStart: "2026-09-25T09:00:00.000Z", sessionEnd: "2026-09-25T17:00:00.000Z" }]);
    listBreakWindows.mockResolvedValue([{ employeeId: "e1", breakStart: "2026-09-25T13:00:00.000Z", breakEnd: "2026-09-25T13:30:00.000Z" }]);
    listCallEvents.mockResolvedValue([]);

    const rows = await getIntervalSummary({ businessDate: "2026-09-25" });

    expect(findBucket(rows, "12:30")).toMatchObject({ presentHC: 1, availableHC: 1 });
    expect(findBucket(rows, "13:00")).toMatchObject({ presentHC: 1, availableHC: 0 });
    // The break's own end (13:30) is exclusive - available again from that bucket.
    expect(findBucket(rows, "13:30")).toMatchObject({ presentHC: 1, availableHC: 1 });
  });

  it("extends buckets past calendar midnight for an overnight shift genuinely owned by this business date, labeling the spillover", async () => {
    listRequirementWindows.mockResolvedValue([{ requiredHC: 2, shiftId: 2, startTime: "22:00", endTime: "02:00", isOvernight: true }]);
    listScheduledEmployeeWindows.mockResolvedValue([{ employeeId: "e2", shiftId: 2, startTime: "22:00", endTime: "02:00", isOvernight: true, isWeeklyOff: false }]);
    listAttendanceWindows.mockResolvedValue([]);
    listBreakWindows.mockResolvedValue([]);
    listCallEvents.mockResolvedValue([]);

    const rows = await getIntervalSummary({ businessDate: "2026-09-25" });

    expect(findBucket(rows, "21:30")).toMatchObject({ requiredHC: 0, scheduledHC: 0 });
    expect(findBucket(rows, "22:00")).toMatchObject({ requiredHC: 2, scheduledHC: 1 });

    const spillover = findBucket(rows, "01:30 (+1d)");
    expect(spillover.intervalStart).toBe("2026-09-26T01:30:00.000Z");
    expect(spillover).toMatchObject({ requiredHC: 2, scheduledHC: 1 });

    // 02:00 next day is the shift's own (exclusive) end - no bucket should extend past it.
    expect(rows.some((r) => r.intervalStart === "2026-09-26T02:00:00.000Z")).toBe(false);
  });

  it("attributes a real call to exactly the bucket containing its own IntervalStart, computing AHT/Service Level/Occupancy only there", async () => {
    listRequirementWindows.mockResolvedValue([{ requiredHC: 1, shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false }]);
    listScheduledEmployeeWindows.mockResolvedValue([{ employeeId: "e1", shiftId: 1, startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]);
    listAttendanceWindows.mockResolvedValue([{ employeeId: "e1", sessionStart: "2026-09-25T09:00:00.000Z", sessionEnd: "2026-09-25T17:00:00.000Z" }]);
    listBreakWindows.mockResolvedValue([]);
    listCallEvents.mockResolvedValue([{ intervalStart: "2026-09-25T10:05:00.000Z", answered: true, abandoned: false, handleSeconds: 300, answeredWithinThreshold: true }]);

    const rows = await getIntervalSummary({ businessDate: "2026-09-25" });

    const withCall = findBucket(rows, "10:00");
    expect(withCall).toMatchObject({ offeredCalls: 1, answeredCalls: 1, abandonedCalls: 0, ahtSeconds: 300, serviceLevelPct: 100 });
    expect(withCall.occupancyPct).toBe(16.67); // (1 x 300s / 3600) / (1 present x 0.5h bucket) x 100

    // No call landed here - present but idle, a real (not null) 0% occupancy, distinct from "nobody present".
    const withoutCall = findBucket(rows, "10:30");
    expect(withoutCall).toMatchObject({ offeredCalls: 0, ahtSeconds: null, serviceLevelPct: null, occupancyPct: 0 });
  });
});
