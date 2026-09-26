import { describe, expect, it } from "vitest";
import { exceedsMassExitThreshold, isRealTransfer } from "../src/modules/imports/orgHierarchyImporter.js";

describe("isRealTransfer", () => {
  const BASE = { wasInsert: false, oldDepartmentId: 1, newDepartmentId: 1, oldLocationId: 1, newLocationId: 1, oldPrimaryProcessId: 1, newPrimaryProcessId: 1 };

  it("is never a transfer for a fresh insert, even if every field looks different", () => {
    expect(isRealTransfer({ ...BASE, wasInsert: true, oldDepartmentId: null, newDepartmentId: 5 })).toBe(false);
  });

  it("is not a transfer when nothing changed", () => {
    expect(isRealTransfer(BASE)).toBe(false);
  });

  it("is a transfer when Department changed", () => {
    expect(isRealTransfer({ ...BASE, newDepartmentId: 2 })).toBe(true);
  });

  it("is a transfer when Location changed", () => {
    expect(isRealTransfer({ ...BASE, newLocationId: 2 })).toBe(true);
  });

  it("is a transfer when the primary Process changed", () => {
    expect(isRealTransfer({ ...BASE, newPrimaryProcessId: 2 })).toBe(true);
  });

  it("is a transfer when a dimension goes from a real value to null (or vice versa)", () => {
    expect(isRealTransfer({ ...BASE, oldDepartmentId: 1, newDepartmentId: null })).toBe(true);
  });
});

describe("exceedsMassExitThreshold", () => {
  it("does not flag a small, ordinary trickle of missing employees", () => {
    expect(exceedsMassExitThreshold(2, 100, 0.2)).toBe(false);
  });

  it("flags when missing employees exceed the configured fraction", () => {
    expect(exceedsMassExitThreshold(30, 100, 0.2)).toBe(true);
  });

  it("is a boundary of > not >=, so exactly the threshold fraction is still safe", () => {
    expect(exceedsMassExitThreshold(20, 100, 0.2)).toBe(false);
  });

  it("never flags when there is no existing active roster to compare against", () => {
    expect(exceedsMassExitThreshold(5, 0, 0.2)).toBe(false);
  });
});
