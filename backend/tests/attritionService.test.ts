import { beforeEach, describe, expect, it, vi } from "vitest";

const getHeadcountAsOf = vi.fn();
const getJoinersCount = vi.fn();
const getExitsCount = vi.fn();
const getTransfersCount = vi.fn();
const countActiveEmployeesMissingJoinDate = vi.fn();
const listJoinersAndExits = vi.fn();
const listTransfers = vi.fn();
vi.mock("../src/modules/attrition/attrition.repository.js", () => ({
  getHeadcountAsOf,
  getJoinersCount,
  getExitsCount,
  getTransfersCount,
  countActiveEmployeesMissingJoinDate,
  listJoinersAndExits,
  listTransfers,
}));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

const { getSummary } = await import("../src/modules/attrition/attrition.service.js");

beforeEach(() => {
  getHeadcountAsOf.mockReset();
  getJoinersCount.mockReset();
  getExitsCount.mockReset();
  getTransfersCount.mockReset();
  countActiveEmployeesMissingJoinDate.mockReset().mockResolvedValue(0);
  recordCalculation.mockClear();
});

describe("getSummary", () => {
  it("computes Attrition Rate as Exits / average(Opening, Closing) x 100 and ledger-logs it company-wide", async () => {
    getHeadcountAsOf.mockImplementation((_asOf: string, inclusive: boolean) => Promise.resolve(inclusive ? 95 : 100)); // opening=100, closing=95
    getJoinersCount.mockResolvedValue(5);
    getExitsCount.mockResolvedValue(10);
    getTransfersCount.mockResolvedValue(3);

    const result = await getSummary({ from: "2026-09-01", to: "2026-09-30" });

    // average HC = (100 + 95) / 2 = 97.5; rate = 10 / 97.5 x 100 = 10.26
    expect(result).toMatchObject({ openingHC: 100, closingHC: 95, joiners: 5, exits: 10, transfers: 3, attritionRatePct: 10.26, employeesMissingJoinDate: 0 });
    expect(recordCalculation).toHaveBeenCalledWith(
      expect.objectContaining({ formulaCode: "ATTRITION_RATE_PCT", entityType: "Company", entityId: "ALL", businessDate: "2026-09-30", computedValue: 10.26 }),
    );
  });

  it("reports null Attrition Rate (not a divide-by-zero) and skips the ledger write when there is no headcount at all", async () => {
    getHeadcountAsOf.mockResolvedValue(0);
    getJoinersCount.mockResolvedValue(0);
    getExitsCount.mockResolvedValue(0);
    getTransfersCount.mockResolvedValue(0);

    const result = await getSummary({ from: "2026-09-01", to: "2026-09-30", departmentId: 7 });

    expect(result.attritionRatePct).toBeNull();
    expect(recordCalculation).not.toHaveBeenCalled();
  });

  it("ledger-logs against the filtered dimension's own entity type/id, preferring Process over Department/Location/Designation", async () => {
    getHeadcountAsOf.mockResolvedValue(10);
    getJoinersCount.mockResolvedValue(0);
    getExitsCount.mockResolvedValue(1);
    getTransfersCount.mockResolvedValue(0);

    await getSummary({ from: "2026-09-01", to: "2026-09-30", processId: 42, departmentId: 7 });

    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ entityType: "Process", entityId: "42" }));
  });

  it("passes the dimension filters through unchanged to every repository call", async () => {
    getHeadcountAsOf.mockResolvedValue(10);
    getJoinersCount.mockResolvedValue(0);
    getExitsCount.mockResolvedValue(0);
    getTransfersCount.mockResolvedValue(0);

    await getSummary({ from: "2026-09-01", to: "2026-09-30", locationId: 3, designationId: 9 });

    expect(getJoinersCount).toHaveBeenCalledWith("2026-09-01", "2026-09-30", expect.objectContaining({ locationId: 3, designationId: 9 }));
    expect(getExitsCount).toHaveBeenCalledWith("2026-09-01", "2026-09-30", expect.objectContaining({ locationId: 3, designationId: 9 }));
    expect(getTransfersCount).toHaveBeenCalledWith("2026-09-01", "2026-09-30", expect.objectContaining({ locationId: 3, designationId: 9 }));
  });

  it("surfaces employeesMissingJoinDate as a real, unhidden caveat", async () => {
    getHeadcountAsOf.mockResolvedValue(10);
    getJoinersCount.mockResolvedValue(0);
    getExitsCount.mockResolvedValue(0);
    getTransfersCount.mockResolvedValue(0);
    countActiveEmployeesMissingJoinDate.mockResolvedValue(4);

    const result = await getSummary({ from: "2026-09-01", to: "2026-09-30" });
    expect(result.employeesMissingJoinDate).toBe(4);
  });
});
