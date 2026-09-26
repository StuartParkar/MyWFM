import { beforeEach, describe, expect, it, vi } from "vitest";

const listScheduleAndShrinkageDays = vi.fn();
const listEntriesForRange = vi.fn();
const createEntry = vi.fn(async () => 1);
const getEntry = vi.fn();
const updateEntry = vi.fn(async () => undefined);
const deleteEntry = vi.fn(async () => undefined);

vi.mock("../src/modules/shrinkage/shrinkage.repository.js", () => ({
  listScheduleAndShrinkageDays,
  listEntriesForRange,
  createEntry,
  getEntry,
  updateEntry,
  deleteEntry,
}));

const recordAudit = vi.fn(async () => undefined);
vi.mock("../src/modules/audit/audit.service.js", () => ({ recordAudit }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

vi.mock("../src/config/appConfig.js", () => ({
  getConfigString: (key: string, fallback: string) => (key === "business_day.timezone" ? "UTC" : fallback),
  getConfigNumber: (_key: string, fallback: number) => fallback,
}));

const { listDailyShrinkage, recordEntry, adjustEntry, removeEntry } = await import("../src/modules/shrinkage/shrinkage.service.js");
const { NotFoundError } = await import("../src/errors/AppError.js");

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

function entry(overrides: Partial<{ shrinkageEntryId: number; categoryCode: string; categoryName: string; minutes: number }>) {
  return {
    shrinkageEntryId: 1,
    employeeId: "e1",
    businessDate: "2026-09-25",
    shrinkageCategoryId: 1,
    categoryCode: "TRAINING",
    categoryName: "Training",
    minutes: 60,
    notes: null,
    source: "MANUAL" as const,
    ...overrides,
  };
}

beforeEach(() => {
  listScheduleAndShrinkageDays.mockReset();
  listEntriesForRange.mockReset();
  createEntry.mockClear();
  getEntry.mockReset();
  updateEntry.mockClear();
  deleteEntry.mockClear();
  recordAudit.mockClear();
  recordCalculation.mockClear();
});

describe("listDailyShrinkage", () => {
  it("computes shrinkage % against a 9-hour scheduled day (540 scheduled minutes)", async () => {
    listScheduleAndShrinkageDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listEntriesForRange.mockResolvedValue([entry({ minutes: 90 })]);

    const result = await listDailyShrinkage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.scheduledHours).toBe(9);
    expect(summary.totalMinutes).toBe(90);
    expect(summary.shrinkagePct).toBe(16.67); // 90 / 540 * 100
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "SHRINKAGE_PCT", computedValue: 16.67 }));
  });

  it("sums minutes across multiple entries in the same category and keeps categories separate", async () => {
    listScheduleAndShrinkageDays.mockResolvedValue(paginated([DAY_SHIFT_KEY]));
    listEntriesForRange.mockResolvedValue([
      entry({ shrinkageEntryId: 1, categoryCode: "TRAINING", categoryName: "Training", minutes: 30 }),
      entry({ shrinkageEntryId: 2, categoryCode: "TRAINING", categoryName: "Training", minutes: 15 }),
      entry({ shrinkageEntryId: 3, categoryCode: "BREAK", categoryName: "Break", minutes: 20 }),
    ]);

    const result = await listDailyShrinkage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.totalMinutes).toBe(65);
    expect(summary.byCategory).toEqual(
      expect.arrayContaining([
        { categoryCode: "TRAINING", categoryName: "Training", minutes: 45 },
        { categoryCode: "BREAK", categoryName: "Break", minutes: 20 },
      ]),
    );
  });

  it("reports null shrinkage % on a weekly-off day rather than dividing by zero", async () => {
    listScheduleAndShrinkageDays.mockResolvedValue(paginated([{ ...DAY_SHIFT_KEY, shiftId: null, shiftCode: null, startTime: null, endTime: null, isOvernight: null, isWeeklyOff: true }]));
    listEntriesForRange.mockResolvedValue([entry({ minutes: 30 })]);

    const result = await listDailyShrinkage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.scheduledHours).toBe(0);
    expect(summary.shrinkagePct).toBeNull();
    expect(recordCalculation).not.toHaveBeenCalled();
  });

  it("reports null shrinkage % (not a fabricated one) when there is no schedule to compare against", async () => {
    listScheduleAndShrinkageDays.mockResolvedValue(
      paginated([{ ...DAY_SHIFT_KEY, shiftId: null, shiftCode: null, startTime: null, endTime: null, isOvernight: null, isWeeklyOff: false }]),
    );
    listEntriesForRange.mockResolvedValue([entry({ minutes: 30 })]);

    const result = await listDailyShrinkage({ from: "2026-09-25", to: "2026-09-25", page: 1, pageSize: 50 });
    const summary = result.items[0]!;

    expect(summary.scheduledHours).toBeNull();
    expect(summary.totalMinutes).toBe(30);
    expect(summary.shrinkagePct).toBeNull();
  });
});

describe("recordEntry / adjustEntry / removeEntry", () => {
  it("records a shrinkage entry and audits it", async () => {
    await recordEntry({ employeeId: "e1", businessDate: "2026-09-25", shrinkageCategoryId: 1, minutes: 30, recordedByUserId: "user-1" });
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "e1", source: "MANUAL" }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "ShrinkageEntry", action: "CREATE" }));
  });

  it("adjusts an existing entry with a mandatory reason", async () => {
    getEntry.mockResolvedValue(entry({}));
    await adjustEntry(1, { minutes: 45 }, "Corrected duration", "user-1");
    expect(updateEntry).toHaveBeenCalledWith(1, { minutes: 45 });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ADJUST", reason: "Corrected duration" }));
  });

  it("throws NotFoundError adjusting an entry that doesn't exist", async () => {
    getEntry.mockResolvedValue(null);
    await expect(adjustEntry(999, { minutes: 10 }, "reason", "user-1")).rejects.toThrow(NotFoundError);
  });

  it("removes an entry with a mandatory reason", async () => {
    getEntry.mockResolvedValue(entry({}));
    await removeEntry(1, "Duplicate", "user-1");
    expect(deleteEntry).toHaveBeenCalledWith(1);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", reason: "Duplicate" }));
  });

  it("throws NotFoundError removing an entry that doesn't exist", async () => {
    getEntry.mockResolvedValue(null);
    await expect(removeEntry(999, "reason", "user-1")).rejects.toThrow(NotFoundError);
  });
});
