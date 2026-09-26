import { describe, expect, it } from "vitest";
import { addDays, endOfMonth, resolveDateRangePreset, startOfMonth, startOfWeek } from "../src/businessDate.js";

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
