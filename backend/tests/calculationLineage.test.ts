import { beforeEach, describe, expect, it, vi } from "vitest";

const getCalculationById = vi.fn();
vi.mock("../src/modules/formula/formula.repository.js", () => ({ getCalculationById: (...args: unknown[]) => getCalculationById(...args) }));

const getImportRunSummaries = vi.fn();
vi.mock("../src/modules/imports/import.repository.js", () => ({ getImportRunSummaries: (...args: unknown[]) => getImportRunSummaries(...args) }));

const { getCalculationLineage, parseImportRunIds } = await import("../src/modules/formula/formula.service.js");

beforeEach(() => {
  getCalculationById.mockReset();
  getImportRunSummaries.mockReset();
});

describe("parseImportRunIds", () => {
  it("extracts every real IMPORT-* code's numeric id", () => {
    expect(parseImportRunIds("IMPORT-00000001,IMPORT-00000004")).toEqual([1, 4]);
  });

  it("ignores a trailing truncation marker rather than treating it as a code", () => {
    expect(parseImportRunIds("IMPORT-00000001,IMPORT-00000002,+5 more")).toEqual([1, 2]);
  });
});

describe("getCalculationLineage", () => {
  it("returns null when the calculation doesn't exist", async () => {
    getCalculationById.mockResolvedValue(null);
    expect(await getCalculationLineage(999)).toBeNull();
    expect(getImportRunSummaries).not.toHaveBeenCalled();
  });

  it("resolves the real import run(s) named by a Calls-derived formula's SourceReference", async () => {
    getCalculationById.mockResolvedValue({
      calculationLedgerId: 42,
      calculationCode: "CALC-00000042",
      formulaCode: "ANSWER_RATE_PCT",
      formulaVersion: 1,
      formulaVersionLabel: "ANSWER_RATE_PCT-V1",
      entityType: "Queue",
      entityId: "3",
      businessDate: "2026-09-20",
      computedValue: 92.5,
      inputsSnapshot: { offeredCalls: 100, answeredCalls: 92 },
      sourceReference: "IMPORT-00000007",
      computedAt: "2026-09-20T10:00:00.000Z",
    });
    getImportRunSummaries.mockResolvedValue([{ importRunId: 7, importCode: "IMPORT-00000007", sourceSystem: "VONAGE_QUEUEWISE", fileName: "queue-2026-09-20.csv", status: "COMPLETED", uploadedAt: "2026-09-20T09:00:00.000Z" }]);

    const lineage = await getCalculationLineage(42);

    expect(getImportRunSummaries).toHaveBeenCalledWith([7]);
    expect(lineage?.sourceImportRuns).toHaveLength(1);
    expect(lineage?.sourceImportRuns[0]).toMatchObject({ importCode: "IMPORT-00000007", sourceSystem: "VONAGE_QUEUEWISE" });
  });

  it("reports an honestly-empty sourceImportRuns list when the formula wasn't computed from any import run", async () => {
    getCalculationById.mockResolvedValue({
      calculationLedgerId: 10,
      calculationCode: "CALC-00000010",
      formulaCode: "SHRINKAGE_PCT",
      formulaVersion: 1,
      formulaVersionLabel: "SHRINKAGE_PCT-V1",
      entityType: "Employee",
      entityId: "e1",
      businessDate: "2026-09-20",
      computedValue: 12.5,
      inputsSnapshot: { totalMinutes: 60 },
      sourceReference: null,
      computedAt: "2026-09-20T10:00:00.000Z",
    });

    const lineage = await getCalculationLineage(10);

    expect(getImportRunSummaries).not.toHaveBeenCalled();
    expect(lineage?.sourceImportRuns).toEqual([]);
  });
});
