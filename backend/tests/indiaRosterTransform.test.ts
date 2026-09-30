import { describe, expect, it } from "vitest";
import { classifyDayCell, deriveNineHourShift, employeeRowToTsvFields, employeeRowsToTsv, extractBusinessDates } from "../src/scripts/indiaRosterTransform.js";

describe("deriveNineHourShift", () => {
  it("derives a same-day shift", () => {
    expect(deriveNineHourShift(700)).toEqual({ shiftCode: "07-16", startTime: "07:00", endTime: "16:00", isOvernight: false });
  });
  it("derives an overnight shift", () => {
    expect(deriveNineHourShift(1600)).toEqual({ shiftCode: "16-01", startTime: "16:00", endTime: "01:00", isOvernight: true });
  });
  it("handles the earliest real code (100 = 01:00)", () => {
    expect(deriveNineHourShift(100)).toEqual({ shiftCode: "01-10", startTime: "01:00", endTime: "10:00", isOvernight: false });
  });
  it("handles a boundary code that ends exactly at midnight", () => {
    expect(deriveNineHourShift(1500)).toEqual({ shiftCode: "15-00", startTime: "15:00", endTime: "00:00", isOvernight: true });
  });
  it("rejects an invalid HHMM value", () => {
    expect(() => deriveNineHourShift(2460)).toThrow();
    expect(() => deriveNineHourShift(-100)).toThrow();
  });
});

describe("classifyDayCell", () => {
  it("classifies the four known special codes, case/whitespace-insensitively", () => {
    expect(classifyDayCell("WO")).toEqual({ kind: "WEEKLY_OFF" });
    expect(classifyDayCell(" wo ")).toEqual({ kind: "WEEKLY_OFF" });
    expect(classifyDayCell("L")).toEqual({ kind: "LEAVE" });
    expect(classifyDayCell("EH")).toEqual({ kind: "EXTRA_HEAD" });
    expect(classifyDayCell("FO")).toEqual({ kind: "FESTIVAL_OFF" });
  });
  it("classifies a numeric cell as a shift", () => {
    expect(classifyDayCell(700)).toEqual({ kind: "SHIFT", rawCode: 700 });
  });
  it("classifies a numeric-looking string cell as a shift", () => {
    expect(classifyDayCell("1600")).toEqual({ kind: "SHIFT", rawCode: 1600 });
  });
  it("flags anything else as unknown rather than guessing", () => {
    expect(classifyDayCell("XYZ")).toEqual({ kind: "UNKNOWN", raw: "XYZ" });
    expect(classifyDayCell(null)).toEqual({ kind: "UNKNOWN", raw: null });
    expect(classifyDayCell(undefined)).toEqual({ kind: "UNKNOWN", raw: undefined });
  });
});

describe("employeeRowToTsvFields / employeeRowsToTsv", () => {
  it("blanks and dashes both become empty fields (parseTsv normalizes both to null)", () => {
    expect(employeeRowToTsvFields([100452, "Ajay Suri", "Chase", "DEL", "ABS", "English Sales", "-", "Kam", "-", "-", "-", "Hugh"])).toEqual([
      "100452", "Ajay Suri", "Chase", "DEL", "ABS", "English Sales", "-", "Kam", "-", "-", "-", "Hugh",
    ]);
    expect(employeeRowToTsvFields([100843, "X", "Y", "DEL", "ABS", "Dept", null, "Kam", "-", "-", "-", "Hugh"])[6]).toBe("");
  });
  it("strips stray tabs/newlines so the TSV shape can't be corrupted by a cell value", () => {
    expect(employeeRowToTsvFields(["Weird\tName\n"])).toEqual(["Weird Name"]);
  });
  it("joins a header and data rows into real tab-separated lines", () => {
    const tsv = employeeRowsToTsv(["Emp ID", "Name"], [[100452, "Ajay Suri"]]);
    expect(tsv).toBe("Emp ID\tName\n100452\tAjay Suri");
  });
});

describe("extractBusinessDates", () => {
  it("converts real Date headers to YYYY-MM-DD", () => {
    const dates = [new Date(Date.UTC(2026, 8, 28)), new Date(Date.UTC(2026, 9, 4))];
    expect(extractBusinessDates(dates)).toEqual(["2026-09-28", "2026-10-04"]);
  });
  it("fails loudly on a non-date header rather than silently misreading a shifted column", () => {
    expect(() => extractBusinessDates(["Mon"])).toThrow();
  });
});
