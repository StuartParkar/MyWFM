import { describe, expect, it } from "vitest";
import { buildImportSourceReference } from "../src/modules/calls/callMetrics.service.js";

describe("buildImportSourceReference", () => {
  it("returns null when no import run fed this bucket", () => {
    expect(buildImportSourceReference([])).toBeNull();
  });

  it("formats a single real ImportRunId as an IMPORT-* code", () => {
    expect(buildImportSourceReference([7])).toBe("IMPORT-00000007");
  });

  it("de-duplicates and sorts several real import runs behind one bucket", () => {
    expect(buildImportSourceReference([4, 1, 4, 2])).toBe("IMPORT-00000001,IMPORT-00000002,IMPORT-00000004");
  });

  it("degrades gracefully to a truncated list + count rather than overflowing SourceReference's NVARCHAR(100)", () => {
    const manyRuns = Array.from({ length: 10 }, (_, i) => i + 1); // 10 codes x 15 chars + separators > 100
    const result = buildImportSourceReference(manyRuns)!;
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toBe("IMPORT-00000001,IMPORT-00000002,IMPORT-00000003,IMPORT-00000004,IMPORT-00000005,+5 more");
  });
});
