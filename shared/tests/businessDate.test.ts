import { describe, expect, it } from "vitest";
import {
  addDays,
  combineLocalDateTime,
  endOfMonth,
  resolveBusinessDate,
  resolveDateRangePreset,
  resolveGlobalBusinessDate,
  startOfMonth,
  startOfWeek,
} from "../src/businessDate.js";

// Wednesday, matching the header row's date in the project's build spec.
const REFERENCE = "2026-09-30";

describe("addDays", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addDays(REFERENCE, 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });
});

describe("startOfWeek / endOfWeek", () => {
  it("resolves to the Monday of the reference date's week", () => {
    // 2026-09-30 is a Wednesday.
    expect(startOfWeek(REFERENCE)).toBe("2026-09-28");
  });
});

describe("startOfMonth / endOfMonth", () => {
  it("resolves month boundaries correctly", () => {
    expect(startOfMonth(REFERENCE)).toBe("2026-09-01");
    expect(endOfMonth(REFERENCE)).toBe("2026-09-30");
  });

  it("handles a leap-adjacent February correctly", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29"); // 2028 is a leap year
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });
});

describe("resolveDateRangePreset", () => {
  it("YESTERDAY is a single-day range, one day before the reference date", () => {
    const range = resolveDateRangePreset("YESTERDAY", REFERENCE);
    expect(range).toEqual({ preset: "YESTERDAY", startDate: "2026-09-29", endDate: "2026-09-29" });
  });

  it("LAST_7_DAYS excludes the reference date itself", () => {
    const range = resolveDateRangePreset("LAST_7_DAYS", REFERENCE);
    expect(range.startDate).toBe("2026-09-23");
    expect(range.endDate).toBe("2026-09-29");
  });

  it("THIS_MONTH spans the full calendar month", () => {
    const range = resolveDateRangePreset("THIS_MONTH", REFERENCE);
    expect(range).toEqual({ preset: "THIS_MONTH", startDate: "2026-09-01", endDate: "2026-09-30" });
  });

  it("LAST_MONTH resolves to the prior calendar month even across a year boundary", () => {
    const range = resolveDateRangePreset("LAST_MONTH", "2026-01-15");
    expect(range).toEqual({ preset: "LAST_MONTH", startDate: "2025-12-01", endDate: "2025-12-31" });
  });

  it("CUSTOM requires and echoes back an explicit range", () => {
    const range = resolveDateRangePreset("CUSTOM", REFERENCE, { startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(range).toEqual({ preset: "CUSTOM", startDate: "2026-01-01", endDate: "2026-01-31" });
  });

  it("CUSTOM without a range throws rather than silently guessing", () => {
    expect(() => resolveDateRangePreset("CUSTOM", REFERENCE)).toThrow();
  });
});

describe("resolveBusinessDate (build spec section 9's worked example)", () => {
  const OVERNIGHT = { endTime: "02:00", isOvernight: true };

  it("keeps an overnight shift's login and logout on the same business date", () => {
    // 5PM -> 2AM shift, business date 25-Sep-2026.
    expect(resolveBusinessDate("2026-09-25T17:00:00.000Z", "UTC", OVERNIGHT)).toBe("2026-09-25");
    expect(resolveBusinessDate("2026-09-26T02:00:00.000Z", "UTC", OVERNIGHT)).toBe("2026-09-25");
  });

  it("rolls back right up to the boundary but not past it", () => {
    expect(resolveBusinessDate("2026-09-26T01:59:00.000Z", "UTC", OVERNIGHT)).toBe("2026-09-25");
    expect(resolveBusinessDate("2026-09-26T02:01:00.000Z", "UTC", OVERNIGHT)).toBe("2026-09-26");
  });

  it("never adjusts a non-overnight shift, even for a stray out-of-window punch", () => {
    const dayShift = { endTime: "18:00", isOvernight: false };
    expect(resolveBusinessDate("2026-09-25T00:30:00.000Z", "UTC", dayShift)).toBe("2026-09-25");
    expect(resolveBusinessDate("2026-09-25T18:00:00.000Z", "UTC", dayShift)).toBe("2026-09-25");
  });

  it('never adjusts when endTime is exactly "00:00", even though isOvernight is true', () => {
    expect(resolveBusinessDate("2026-09-25T00:00:00.000Z", "UTC", { endTime: "00:00", isOvernight: true })).toBe("2026-09-25");
  });

  it("converts to the target timezone before comparing, not the instant's UTC date", () => {
    // 2026-09-25T20:00:00Z is 2026-09-26T01:30 in Asia/Kolkata (UTC+5:30) - the overnight
    // tail of the 25th's shift in Kolkata local time, despite still being the 25th in UTC.
    expect(resolveBusinessDate("2026-09-25T20:00:00.000Z", "Asia/Kolkata", OVERNIGHT)).toBe("2026-09-25");
  });
});

describe("resolveGlobalBusinessDate", () => {
  it('with the seeded "00:00" day-start, matches the plain local calendar date at any time', () => {
    expect(resolveGlobalBusinessDate("2026-09-25T00:00:00.000Z", "UTC", "00:00")).toBe("2026-09-25");
    expect(resolveGlobalBusinessDate("2026-09-25T23:59:00.000Z", "UTC", "00:00")).toBe("2026-09-25");
  });

  it("rolls a pre-cutoff instant back to the previous business date when the day starts later than midnight", () => {
    expect(resolveGlobalBusinessDate("2026-09-25T05:00:00.000Z", "UTC", "06:00")).toBe("2026-09-24");
    expect(resolveGlobalBusinessDate("2026-09-25T06:00:00.000Z", "UTC", "06:00")).toBe("2026-09-25");
  });
});

describe("combineLocalDateTime", () => {
  it("is a no-op conversion in UTC", () => {
    expect(combineLocalDateTime("2026-09-25", "17:00", "UTC")).toBe("2026-09-25T17:00:00.000Z");
  });

  it("converts a fixed-offset zone with no DST (Asia/Kolkata, UTC+5:30)", () => {
    // 17:00 IST is 11:30 UTC the same day.
    expect(combineLocalDateTime("2026-09-25", "17:00", "Asia/Kolkata")).toBe("2026-09-25T11:30:00.000Z");
  });

  it("converts a negative-offset DST zone correctly (America/New_York, EST = UTC-5 in January)", () => {
    expect(combineLocalDateTime("2026-01-15", "09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
  });

  it("round-trips with resolveBusinessDate's worked example: the shift's own EndTime combined onto the next day matches the logout instant", () => {
    // Shift 17:00 -> 02:00, business date 25-Sep-2026: the scheduled end is 02:00 on the
    // *following* calendar day, 26-Sep-2026.
    const scheduledEnd = combineLocalDateTime("2026-09-26", "02:00", "UTC");
    expect(resolveBusinessDate(scheduledEnd, "UTC", { endTime: "02:00", isOvernight: true })).toBe("2026-09-25");
  });
});
