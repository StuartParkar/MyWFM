import { beforeEach, describe, expect, it, vi } from "vitest";

const listScheduleAndSessionDays = vi.fn();
const listSessionsForKeys = vi.fn();
const createSession = vi.fn(async () => 1);
const getSession = vi.fn();
const updateSession = vi.fn(async () => undefined);
const deleteSession = vi.fn(async () => undefined);

vi.mock("../src/modules/attendance/attendance.repository.js", () => ({
  listScheduleAndSessionDays,
  listSessionsForKeys,
  createSession,
  getSession,
  updateSession,
  deleteSession,
}));

const recordAudit = vi.fn(async () => undefined);
vi.mock("../src/modules/audit/audit.service.js", () => ({ recordAudit }));

// Pinned to UTC + the same grace/gap defaults as the seeded config, so expected numbers in
// this file are plain arithmetic rather than needing IST-offset conversions, and stay correct
// even if the seeded defaults are later tuned.
vi.mock("../src/config/appConfig.js", () => ({
  getConfigString: (key: string, fallback: string) => (key === "business_day.timezone" ? "UTC" : fallback),
  getConfigNumber: (_key: string, fallback: number) => fallback,
}));

const { listDailySummaries, recordSession, adjustSession, removeSession } = await import("../src/modules/attendance/attendance.service.js");
const { NotFoundError, ValidationError } = await import("../src/errors/AppError.js");

function paginated<T>(items: T[]) {
  return { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 };
}

const DAY_SHIFT_KEY = {
  employeeId: "e1",
  employeeCode: "E1",
  employeeName: "Alice",
  businessDate: "2026-09-25",
  shiftId: 1,
  shiftCode: "D1",
  startTime: "09:00",
  endTime: "18:00",
  isOvernight: false,
  isWeeklyOff: false,
};

const OVERNIGHT_KEY = { ...DAY_SHIFT_KEY, shiftId: 2, shiftCode: "N1", startTime: "17:00", endTime: "02:00", isOvernight: true };

function session(overrides: Partial<{ attendanceSessionId: number; employeeId: string; businessDate: string; sessionStart: string; sessionEnd: string | null; breakMinutes: number }>) {
  return {
    attendanceSessionId: 1,
    employeeId: "e1",
    businessDate: "2026-09-25",
    sessionStart: "2026-09-25T09:00:00.000Z",
    sessionEnd: "2026-09-25T18:00:00.000Z",
    breakMinutes: 0,
    source: "MANUAL" as const,
    ...overrides,
  };
}

beforeEach(() => {
  listScheduleAndSessionDays.mockReset();
  listSessionsForKeys.mockReset();
  createSession.mockClear();
  getSession.mockReset();
  updateSession.mockClear();
  deleteSession.mockClear();
  recordAudit.mockClear();
});

describe("listDailySummaries", () => {
  it("computes gross/net hours, variance and late minutes for a day shift arriving past grace", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listSessionsForKeys.mockResolvedValue([
      session({ sessionStart: "2026-09-25T09:10:00.000Z", sessionEnd: "2026-09-25T18:00:00.000Z", breakMinutes: 30 }),
    ]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.scheduledStart).toBe("2026-09-25T09:00:00.000Z");
    expect(summary.scheduledEnd).toBe("2026-09-25T18:00:00.000Z");
    expect(summary.scheduledHours).toBe(9);
    expect(summary.grossLoginHours).toBe(8.83); // 8h50m
    expect(summary.netWorkingHours).toBe(8.33); // 8h50m - 30m break
    expect(summary.varianceHours).toBe(-0.67);
    expect(summary.lateMinutes).toBe(10); // 10 min late, grace is 5
    expect(summary.earlyLogoutMinutes).toBe(0);
    expect(summary.status).toBe("PRESENT");
  });

  it("keeps an overnight shift's login and scheduled window on the same business date without splitting at midnight", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([OVERNIGHT_KEY]));
    listSessionsForKeys.mockResolvedValue([session({ sessionStart: "2026-09-25T17:00:00.000Z", sessionEnd: "2026-09-26T02:00:00.000Z" })]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.scheduledStart).toBe("2026-09-25T17:00:00.000Z");
    expect(summary.scheduledEnd).toBe("2026-09-26T02:00:00.000Z");
    expect(summary.scheduledHours).toBe(9);
    expect(summary.grossLoginHours).toBe(9);
    expect(summary.netWorkingHours).toBe(9);
    expect(summary.varianceHours).toBe(0);
    expect(summary.lateMinutes).toBe(0);
    expect(summary.earlyLogoutMinutes).toBe(0);
  });

  it("marks a scheduled day with no sessions as ABSENT, without fabricating hours", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listSessionsForKeys.mockResolvedValue([]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.status).toBe("ABSENT");
    expect(summary.scheduledHours).toBe(9); // the schedule itself is still known
    expect(summary.firstLogin).toBeNull();
    expect(summary.grossLoginHours).toBeNull();
    expect(summary.netWorkingHours).toBeNull();
    expect(summary.varianceHours).toBeNull();
  });

  it("marks a weekly-off day with no sessions as ON_WEEKLY_OFF with zero scheduled hours", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([{ ...DAY_SHIFT_KEY, shiftId: null, shiftCode: null, startTime: null, endTime: null, isOvernight: null, isWeeklyOff: true }]));
    listSessionsForKeys.mockResolvedValue([]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.status).toBe("ON_WEEKLY_OFF");
    expect(summary.scheduledHours).toBe(0);
    expect(summary.varianceHours).toBeNull(); // nobody worked, so no variance to report
  });

  it("marks an attendance day with no matching schedule as PRESENT, with a null schedule rather than a fabricated one", async () => {
    listScheduleAndSessionDays.mockResolvedValue(
      paginated([{ ...DAY_SHIFT_KEY, shiftId: null, shiftCode: null, startTime: null, endTime: null, isOvernight: null, isWeeklyOff: false }]),
    );
    listSessionsForKeys.mockResolvedValue([session({})]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.status).toBe("PRESENT");
    expect(summary.scheduledHours).toBeNull();
    expect(summary.grossLoginHours).toBe(9);
    expect(summary.varianceHours).toBeNull();
  });

  it("flags DOUBLE_SHIFT_EXCEPTION when the gap between two sessions is under the configured minimum", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listSessionsForKeys.mockResolvedValue([
      session({ attendanceSessionId: 1, sessionStart: "2026-09-25T09:00:00.000Z", sessionEnd: "2026-09-25T13:00:00.000Z" }),
      session({ attendanceSessionId: 2, sessionStart: "2026-09-25T15:00:00.000Z", sessionEnd: "2026-09-25T18:00:00.000Z" }), // 2h gap, under the 5h minimum
    ]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    expect(result.items[0]!.doubleShiftException).toBe(true);
  });

  it("does not flag a double shift when the gap meets the configured minimum", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listSessionsForKeys.mockResolvedValue([
      session({ attendanceSessionId: 1, sessionStart: "2026-09-25T09:00:00.000Z", sessionEnd: "2026-09-25T11:00:00.000Z" }),
      session({ attendanceSessionId: 2, sessionStart: "2026-09-25T16:00:00.000Z", sessionEnd: "2026-09-25T18:00:00.000Z" }), // 5h gap, exactly the minimum
    ]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    expect(result.items[0]!.doubleShiftException).toBe(false);
  });

  it("treats a still-open session (no logout yet) as PRESENT without inventing an end time", async () => {
    listScheduleAndSessionDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listSessionsForKeys.mockResolvedValue([session({ sessionEnd: null })]);

    const result = await listDailySummaries({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.status).toBe("PRESENT");
    expect(summary.sessionCount).toBe(1);
    expect(summary.lastLogout).toBeNull();
    expect(summary.grossLoginHours).toBeNull();
    expect(summary.netWorkingHours).toBeNull();
  });
});

describe("recordSession / adjustSession / removeSession", () => {
  it("records a manual session and audits it", async () => {
    await recordSession({
      employeeId: "e1",
      businessDate: "2026-09-25",
      sessionStart: "2026-09-25T09:00:00.000Z",
      sessionEnd: "2026-09-25T18:00:00.000Z",
      recordedByUserId: "user-1",
    });
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "e1", source: "MANUAL" }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "AttendanceSession", action: "CREATE" }));
  });

  it("rejects a session whose businessDate is implausibly far from its sessionStart", async () => {
    await expect(
      recordSession({
        employeeId: "e1",
        businessDate: "2026-01-01",
        sessionStart: "2026-09-25T09:00:00.000Z",
        recordedByUserId: "user-1",
      }),
    ).rejects.toThrow(ValidationError);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("adjusts an existing session with a mandatory reason and audits before/after", async () => {
    getSession.mockResolvedValue(session({ sessionEnd: "2026-09-25T18:00:00.000Z" }));
    await adjustSession(1, { sessionEnd: "2026-09-25T18:30:00.000Z" }, "Forgot to log out on time", "user-1");
    expect(updateSession).toHaveBeenCalledWith(1, { sessionEnd: "2026-09-25T18:30:00.000Z" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ADJUST", reason: "Forgot to log out on time" }));
  });

  it("throws NotFoundError when adjusting a session that doesn't exist", async () => {
    getSession.mockResolvedValue(null);
    await expect(adjustSession(999, { breakMinutes: 15 }, "reason", "user-1")).rejects.toThrow(NotFoundError);
  });

  it("removes a session with a mandatory reason and audits the before value", async () => {
    const existing = session({});
    getSession.mockResolvedValue(existing);
    await removeSession(1, "Duplicate entry", "user-1");
    expect(deleteSession).toHaveBeenCalledWith(1);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", reason: "Duplicate entry", before: existing }));
  });

  it("throws NotFoundError when removing a session that doesn't exist", async () => {
    getSession.mockResolvedValue(null);
    await expect(removeSession(999, "reason", "user-1")).rejects.toThrow(NotFoundError);
  });
});
