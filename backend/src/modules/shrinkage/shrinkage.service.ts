import type { PaginatedResult } from "@mywfm/shared";
import { getConfigString } from "../../config/appConfig.js";
import { NotFoundError } from "../../errors/AppError.js";
import { recordAudit } from "../audit/audit.service.js";
import { computeScheduledWindow } from "../attendance/attendance.service.js";
import { recordCalculation } from "../formula/calculationLedger.js";
import * as repo from "./shrinkage.repository.js";

const FORMULA_CODE = "SHRINKAGE_PCT";
const FORMULA_VERSION = 1;

export async function recordEntry(input: {
  employeeId: string;
  businessDate: string;
  shrinkageCategoryId: number;
  minutes: number;
  notes?: string | null;
  recordedByUserId: string;
}): Promise<number> {
  const id = await repo.createEntry({ ...input, source: "MANUAL" });
  await recordAudit({ entityType: "ShrinkageEntry", entityId: String(id), action: "CREATE", performedByUserId: input.recordedByUserId, after: input });
  return id;
}

export async function adjustEntry(
  id: number,
  patch: { minutes?: number; shrinkageCategoryId?: number; notes?: string | null },
  reason: string,
  performedByUserId: string,
): Promise<void> {
  const before = await repo.getEntry(id);
  if (!before) throw new NotFoundError("Shrinkage entry not found.");
  await repo.updateEntry(id, patch);
  await recordAudit({ entityType: "ShrinkageEntry", entityId: String(id), action: "ADJUST", performedByUserId, before, after: { ...before, ...patch }, reason });
}

export async function removeEntry(id: number, reason: string, performedByUserId: string): Promise<void> {
  const before = await repo.getEntry(id);
  if (!before) throw new NotFoundError("Shrinkage entry not found.");
  await repo.deleteEntry(id);
  await recordAudit({ entityType: "ShrinkageEntry", entityId: String(id), action: "DELETE", performedByUserId, before, reason });
}

export interface DailyShrinkageSummary {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  scheduledHours: number | null;
  totalMinutes: number;
  byCategory: { categoryCode: string; categoryName: string; minutes: number }[];
  shrinkagePct: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listDailyShrinkage(params: {
  employeeId?: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  computedByUserId?: string;
}): Promise<PaginatedResult<DailyShrinkageSummary>> {
  const tz = getConfigString("business_day.timezone", "Asia/Kolkata");
  const keys = await repo.listScheduleAndShrinkageDays(params);
  const entries = await repo.listEntriesForRange(params.employeeId, params.from, params.to);

  const entriesByKey = new Map<string, repo.ShrinkageEntryRow[]>();
  for (const e of entries) {
    const mapKey = `${e.employeeId}|${e.businessDate}`;
    const list = entriesByKey.get(mapKey);
    if (list) list.push(e);
    else entriesByKey.set(mapKey, [e]);
  }

  const items = await Promise.all(
    keys.items.map(async (key) => {
      const dayEntries = entriesByKey.get(`${key.employeeId}|${key.businessDate}`) ?? [];
      const { scheduledHours } = computeScheduledWindow(key, tz);

      const byCategoryMap = new Map<string, { categoryCode: string; categoryName: string; minutes: number }>();
      for (const e of dayEntries) {
        const existing = byCategoryMap.get(e.categoryCode);
        if (existing) existing.minutes += e.minutes;
        else byCategoryMap.set(e.categoryCode, { categoryCode: e.categoryCode, categoryName: e.categoryName, minutes: e.minutes });
      }
      const totalMinutes = dayEntries.reduce((sum, e) => sum + e.minutes, 0);
      const scheduledMinutes = scheduledHours !== null ? scheduledHours * 60 : null;
      const shrinkagePct = scheduledMinutes !== null && scheduledMinutes > 0 ? round2((totalMinutes / scheduledMinutes) * 100) : null;

      if (shrinkagePct !== null) {
        await recordCalculation({
          formulaCode: FORMULA_CODE,
          formulaVersion: FORMULA_VERSION,
          entityType: "EmployeeShrinkage",
          entityId: key.employeeId,
          businessDate: key.businessDate,
          computedValue: shrinkagePct,
          inputsSnapshot: { totalMinutes, scheduledMinutes, byCategory: Array.from(byCategoryMap.values()) },
          computedByUserId: params.computedByUserId ?? null,
        });
      }

      return {
        employeeId: key.employeeId,
        employeeCode: key.employeeCode,
        employeeName: key.employeeName,
        businessDate: key.businessDate,
        scheduledHours,
        totalMinutes,
        byCategory: Array.from(byCategoryMap.values()),
        shrinkagePct,
      };
    }),
  );

  return { ...keys, items };
}
