import { beforeEach, describe, expect, it, vi } from "vitest";

const listActiveExceptionRules = vi.fn();
const ensureException = vi.fn();
const listHighSeverityDataQualityBreaches = vi.fn();
const listRequirementWindows = vi.fn();
const listScheduledEmployeeWindows = vi.fn();
const listAttendanceWindows = vi.fn();
const listBreakWindows = vi.fn();
const listCallEvents = vi.fn();
vi.mock("../src/modules/intraday/intraday.repository.js", () => ({
  listActiveExceptionRules,
  ensureException,
  listHighSeverityDataQualityBreaches,
  listRequirementWindows,
  listScheduledEmployeeWindows,
  listAttendanceWindows,
  listBreakWindows,
  listCallEvents,
}));

const listProcesses = vi.fn();
vi.mock("../src/modules/masterdata/masterdata.repository.js", () => ({ listProcesses }));

const listScheduleAndSessionDays = vi.fn();
const listSessionsForRange = vi.fn();
vi.mock("../src/modules/attendance/attendance.repository.js", () => ({ listScheduleAndSessionDays, listSessionsForRange }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

const recordAudit = vi.fn(async () => undefined);
vi.mock("../src/modules/audit/audit.service.js", () => ({ recordAudit }));

// Same technique as attendanceService.test.ts / intradayIntervalSummary.test.ts.
vi.mock("../src/config/appConfig.js", () => ({
  getConfigString: (key: string, fallback: string) => (key === "business_day.timezone" ? "UTC" : fallback),
  getConfigNumber: (_key: string, fallback: number) => fallback,
}));

const { scanForExceptions } = await import("../src/modules/intraday/intraday.service.js");

function paginated<T>(items: T[]) {
  return { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 };
}

function rule(overrides: Partial<{ exceptionRuleId: number; ruleCode: string; category: string; description: string; comparisonOperator: string; thresholdValue: number }>) {
  return { exceptionRuleId: 1, ruleCode: "TEST_RULE", category: "STAFFING", description: "test", comparisonOperator: "<", thresholdValue: -2, ...overrides };
}

beforeEach(() => {
  listActiveExceptionRules.mockReset();
  ensureException.mockReset();
  listHighSeverityDataQualityBreaches.mockReset();
  listRequirementWindows.mockReset().mockResolvedValue([]);
  listScheduledEmployeeWindows.mockReset().mockResolvedValue([]);
  listAttendanceWindows.mockReset().mockResolvedValue([]);
  listBreakWindows.mockReset().mockResolvedValue([]);
  listCallEvents.mockReset().mockResolvedValue([]);
  listProcesses.mockReset();
  listScheduleAndSessionDays.mockReset();
  listSessionsForRange.mockReset();
  recordCalculation.mockClear();
  recordAudit.mockClear();
});

describe("scanForExceptions", () => {
  it("detects a real STAFFING_GAP_BREACH from getIntervalSummary's own computed Staffing Gap, one row per breaching bucket", async () => {
    listActiveExceptionRules.mockResolvedValue([rule({ exceptionRuleId: 1, ruleCode: "STAFFING_GAP_BREACH", category: "STAFFING", comparisonOperator: "<", thresholdValue: -2 })]);
    listProcesses.mockResolvedValue([{ id: 10, code: "P1", name: "Process 1" }]);
    // A single 30-minute-wide requirement (09:00-09:30) with nobody scheduled - Staffing Gap
    // (0 - 5 = -5) breaches -2 in exactly the one bucket this requirement's window covers.
    listRequirementWindows.mockResolvedValue([{ requiredHC: 5, shiftId: 1, startTime: "09:00", endTime: "09:30", isOvernight: false }]);
    ensureException.mockResolvedValue(1);

    const result = await scanForExceptions({ businessDate: "2026-09-25" });

    expect(result.newExceptionCount).toBe(1);
    expect(ensureException).toHaveBeenCalledTimes(1);
    expect(ensureException).toHaveBeenCalledWith({
      exceptionRuleId: 1,
      entityType: "Process",
      entityId: "10",
      businessDate: "2026-09-25",
      intervalStart: "2026-09-25T09:00:00.000Z",
      observedValue: -5,
      thresholdValue: -2,
    });
  });

  it("reports zero new exceptions when ensureException finds the breach already open (repeat scan)", async () => {
    listActiveExceptionRules.mockResolvedValue([rule({ exceptionRuleId: 1, ruleCode: "STAFFING_GAP_BREACH", category: "STAFFING", comparisonOperator: "<", thresholdValue: -2 })]);
    listProcesses.mockResolvedValue([{ id: 10, code: "P1", name: "Process 1" }]);
    listRequirementWindows.mockResolvedValue([{ requiredHC: 5, shiftId: 1, startTime: "09:00", endTime: "09:30", isOvernight: false }]);
    ensureException.mockResolvedValue(null); // already open - repository-level dedup

    const result = await scanForExceptions({ businessDate: "2026-09-25" });

    expect(result.newExceptionCount).toBe(0);
    expect(ensureException).toHaveBeenCalledTimes(1); // still evaluated, just not counted as new
  });

  it("detects ATTENDANCE_LATE from real daily attendance summaries, recorded against midnight of the business date", async () => {
    listActiveExceptionRules.mockResolvedValue([rule({ exceptionRuleId: 3, ruleCode: "ATTENDANCE_LATE", category: "ATTENDANCE", comparisonOperator: ">", thresholdValue: 15 })]);
    listScheduleAndSessionDays.mockResolvedValue(
      paginated([{ employeeId: "e1", employeeCode: "E1", employeeName: "Alice", businessDate: "2026-09-25", shiftId: 1, shiftCode: "D1", startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]),
    );
    listSessionsForRange.mockResolvedValue([
      { attendanceSessionId: 1, employeeId: "e1", businessDate: "2026-09-25", sessionStart: "2026-09-25T09:20:00.000Z", sessionEnd: "2026-09-25T17:00:00.000Z", breakMinutes: 0, source: "MANUAL" },
    ]);
    ensureException.mockResolvedValue(1);

    const result = await scanForExceptions({ businessDate: "2026-09-25" });

    expect(result.newExceptionCount).toBe(1);
    expect(ensureException).toHaveBeenCalledWith({
      exceptionRuleId: 3,
      entityType: "Employee",
      entityId: "e1",
      businessDate: "2026-09-25",
      intervalStart: "2026-09-25T00:00:00.000Z",
      observedValue: 20, // 20 minutes late, grace is 5
      thresholdValue: 15,
    });
  });

  it("does not flag ATTENDANCE_LATE when the employee arrived within the grace period", async () => {
    listActiveExceptionRules.mockResolvedValue([rule({ exceptionRuleId: 3, ruleCode: "ATTENDANCE_LATE", category: "ATTENDANCE", comparisonOperator: ">", thresholdValue: 15 })]);
    listScheduleAndSessionDays.mockResolvedValue(
      paginated([{ employeeId: "e1", employeeCode: "E1", employeeName: "Alice", businessDate: "2026-09-25", shiftId: 1, shiftCode: "D1", startTime: "09:00", endTime: "17:00", isOvernight: false, isWeeklyOff: false }]),
    );
    listSessionsForRange.mockResolvedValue([
      { attendanceSessionId: 1, employeeId: "e1", businessDate: "2026-09-25", sessionStart: "2026-09-25T09:02:00.000Z", sessionEnd: "2026-09-25T17:00:00.000Z", breakMinutes: 0, source: "MANUAL" },
    ]);

    const result = await scanForExceptions({ businessDate: "2026-09-25" });

    expect(result.newExceptionCount).toBe(0);
    expect(ensureException).not.toHaveBeenCalled();
  });

  it("detects a DATA_QUALITY breach using the import run's own business date, ignoring the scan's businessDate parameter", async () => {
    listActiveExceptionRules.mockResolvedValue([rule({ exceptionRuleId: 4, ruleCode: "DATA_QUALITY_HIGH_SEVERITY", category: "DATA_QUALITY", comparisonOperator: ">", thresholdValue: 0 })]);
    listHighSeverityDataQualityBreaches.mockResolvedValue([{ importRunId: 77, businessDate: "2026-08-01", highSeverityOpenCount: 3 }]);
    ensureException.mockResolvedValue(1);

    const result = await scanForExceptions({ businessDate: "2026-09-25" }); // a different date than the breach's own

    expect(result.newExceptionCount).toBe(1);
    expect(ensureException).toHaveBeenCalledWith({
      exceptionRuleId: 4,
      entityType: "ImportRun",
      entityId: "77",
      businessDate: "2026-08-01",
      intervalStart: "2026-08-01T00:00:00.000Z",
      observedValue: 3,
      thresholdValue: 0,
    });
    expect(listHighSeverityDataQualityBreaches).toHaveBeenCalledWith(0);
  });
});
