import { beforeEach, describe, expect, it, vi } from "vitest";

const listPublishedRequirementCoverage = vi.fn();
vi.mock("../src/modules/staffing/staffing.repository.js", () => ({ listPublishedRequirementCoverage }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

const { listCoverage } = await import("../src/modules/staffing/staffing.service.js");

function paginated<T>(items: T[]) {
  return { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 };
}

function row(overrides: Partial<{ rosterRequirementId: number; requiredHc: number; scheduledHc: number; presentHc: number }>) {
  return {
    rosterRequirementId: 1,
    businessDate: "2026-09-25",
    departmentId: 1,
    departmentName: "Sales",
    processId: 1,
    processName: "Bookings",
    shiftId: 1,
    shiftCode: "D1",
    requiredHc: 10,
    scheduledHc: 8,
    presentHc: 7,
    ...overrides,
  };
}

beforeEach(() => {
  listPublishedRequirementCoverage.mockReset();
  recordCalculation.mockClear();
});

describe("listCoverage", () => {
  it("computes coverage %, staffing gap and actual staffing gap against the requirement's own RequiredHC", async () => {
    listPublishedRequirementCoverage.mockResolvedValue(paginated([row({})]));

    const result = await listCoverage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.rosterCoveragePct).toBe(80); // 8 / 10 * 100
    expect(summary.staffingGap).toBe(-2); // 8 - 10
    expect(summary.actualStaffingGap).toBe(-3); // 7 - 10
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ROSTER_COVERAGE_PCT", computedValue: 80 }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "STAFFING_GAP", computedValue: -2 }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ACTUAL_STAFFING_GAP", computedValue: -3 }));
  });

  it("reports overstaffing as a positive gap", async () => {
    listPublishedRequirementCoverage.mockResolvedValue(paginated([row({ requiredHc: 5, scheduledHc: 7, presentHc: 6 })]));

    const result = await listCoverage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.rosterCoveragePct).toBe(140);
    expect(summary.staffingGap).toBe(2);
    expect(summary.actualStaffingGap).toBe(1);
  });

  it("reports a null coverage % (not a divide-by-zero) when RequiredHC is zero, while still reporting the gaps", async () => {
    listPublishedRequirementCoverage.mockResolvedValue(paginated([row({ requiredHc: 0, scheduledHc: 2, presentHc: 1 })]));

    const result = await listCoverage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.rosterCoveragePct).toBeNull();
    expect(summary.staffingGap).toBe(2);
    expect(summary.actualStaffingGap).toBe(1);
    expect(recordCalculation).not.toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ROSTER_COVERAGE_PCT" }));
  });
});
