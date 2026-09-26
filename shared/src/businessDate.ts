import type { DateRange, DateRangePreset } from "./types/filters.js";

/**
 * PHASE 1 PLACEHOLDER - calendar-date arithmetic only.
 *
 * Build spec section 9 requires a configurable Business-Day Engine (shift-boundary aware,
 * timezone aware, overnight-shift aware) so that e.g. a 5PM-2AM shift's attendance stays
 * attributed to the shift's start date rather than splitting at midnight. That engine does
 * not exist yet - it is Phase 5. Everything in this file operates on plain calendar dates
 * (YYYY-MM-DD strings, no time-of-day, no timezone conversion) purely so the Global Filter
 * Bar has real, working date-preset math to call in the meantime.
 *
 * Do not extend this file with timezone/shift logic - that belongs in the Phase 5
 * Business Day Engine, which will supersede `resolveDateRangePreset`'s notion of "today"
 * with a real `resolveBusinessDate(nowUtc, shiftConfig, timezone)` call. Everything here
 * takes an already-resolved reference date so callers can swap the source later without
 * changing this module's math.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string): void {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`Expected an ISO date (YYYY-MM-DD), received: "${value}"`);
  }
}

function toUtcDate(isoDate: string): Date {
  assertIsoDate(isoDate);
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, day as number));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, delta: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + delta);
  return toIsoDate(date);
}

/** Monday-based start of week. */
export function startOfWeek(isoDate: string): string {
  const date = toUtcDate(isoDate);
  const dayOfWeek = date.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return toIsoDate(date);
}

export function endOfWeek(isoDate: string): string {
  return addDays(startOfWeek(isoDate), 6);
}

export function startOfMonth(isoDate: string): string {
  const date = toUtcDate(isoDate);
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

export function endOfMonth(isoDate: string): string {
  const date = toUtcDate(isoDate);
  return toIsoDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export interface CustomRange {
  startDate: string;
  endDate: string;
}

/**
 * Resolves a date-range preset into concrete start/end ISO dates.
 *
 * @param preset one of the fixed presets, or "CUSTOM"
 * @param todayBusinessDate the current WFM business date (ISO), as resolved by the caller
 * @param custom required and only used when preset === "CUSTOM"
 */
export function resolveDateRangePreset(
  preset: DateRangePreset,
  todayBusinessDate: string,
  custom?: CustomRange,
): DateRange {
  assertIsoDate(todayBusinessDate);

  switch (preset) {
    case "YESTERDAY": {
      const d = addDays(todayBusinessDate, -1);
      return { preset, startDate: d, endDate: d };
    }
    case "TODAY":
      return { preset, startDate: todayBusinessDate, endDate: todayBusinessDate };
    case "LAST_7_DAYS":
      return { preset, startDate: addDays(todayBusinessDate, -7), endDate: addDays(todayBusinessDate, -1) };
    case "LAST_14_DAYS":
      return { preset, startDate: addDays(todayBusinessDate, -14), endDate: addDays(todayBusinessDate, -1) };
    case "LAST_30_DAYS":
      return { preset, startDate: addDays(todayBusinessDate, -30), endDate: addDays(todayBusinessDate, -1) };
    case "THIS_WEEK":
      return { preset, startDate: startOfWeek(todayBusinessDate), endDate: endOfWeek(todayBusinessDate) };
    case "LAST_WEEK": {
      const lastWeekAnchor = addDays(startOfWeek(todayBusinessDate), -1);
      return { preset, startDate: startOfWeek(lastWeekAnchor), endDate: endOfWeek(lastWeekAnchor) };
    }
    case "THIS_MONTH":
      return { preset, startDate: startOfMonth(todayBusinessDate), endDate: endOfMonth(todayBusinessDate) };
    case "LAST_MONTH": {
      const lastMonthAnchor = addDays(startOfMonth(todayBusinessDate), -1);
      return { preset, startDate: startOfMonth(lastMonthAnchor), endDate: endOfMonth(lastMonthAnchor) };
    }
    case "CUSTOM": {
      if (!custom) {
        throw new Error('resolveDateRangePreset: "custom" range is required when preset is CUSTOM');
      }
      assertIsoDate(custom.startDate);
      assertIsoDate(custom.endDate);
      return { preset, startDate: custom.startDate, endDate: custom.endDate };
    }
    default: {
      const exhaustiveCheck: never = preset;
      throw new Error(`Unhandled date range preset: ${String(exhaustiveCheck)}`);
    }
  }
}
