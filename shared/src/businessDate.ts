import type { DateRange, DateRangePreset } from "./types/filters.js";

/**
 * Calendar-date arithmetic (addDays/startOfWeek/.../resolveDateRangePreset) plus the real
 * Business Day Engine (build spec section 9): `resolveBusinessDate` below. Everything in the
 * first half of this file operates on plain calendar dates (YYYY-MM-DD strings) and takes an
 * already-resolved reference date, so it doesn't care whether that date came from the engine
 * or a placeholder - see frontend/src/lib/filters/businessToday.ts for how the Global Filter
 * Bar gets its reference date now that the engine exists.
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

// ---------------------------------------------------------------------------
// Business Day Engine (build spec section 9)
// ---------------------------------------------------------------------------

/**
 * The overnight-rollover rule a punch's business date is resolved against.
 * `endTime` is a wall-clock "HH:MM" in whatever timezone the caller passes to
 * `resolveBusinessDate` - it is never itself timezone-aware.
 */
export interface OvernightBoundary {
  /** The boundary's end-of-window cutoff, e.g. a shift's EndTime. */
  endTime: string;
  isOvernight: boolean;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertHhMm(value: string, label: string): void {
  if (!HHMM_RE.test(value)) {
    throw new Error(`Expected ${label} as a 24-hour "HH:MM" time, received: "${value}"`);
  }
}

/** Splits a UTC instant into the local calendar date and "HH:MM" it falls on in `timezone`, with no external date library. */
function toLocalDateTime(instantIso: string, timezone: string): { date: string; time: string } {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Expected a valid ISO instant, received: "${instantIso}"`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  // Some locales/environments render midnight as "24:00" under formatToParts - normalize it
  // back to "00:00" of the same calendar day (Intl already rolled the date part forward).
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

/** The calendar-date half of `toLocalDateTime`, for callers that only need the date. */
export function toLocalCalendarDate(instantIso: string, timezone: string): string {
  return toLocalDateTime(instantIso, timezone).date;
}

/**
 * The reverse of `toLocalDateTime`: combines a local wall-clock date + "HH:MM" in `timezone`
 * into the UTC instant it represents (e.g. a shift's StartTime on a given business date, for
 * comparison against a stored attendance timestamp). Uses the standard guess-and-correct
 * approach (no timezone database is available to look up a zone's UTC offset directly): a
 * first guess treats the wall-clock components as UTC, then one or two correction passes
 * measure the guess's actual local time in `timezone` and adjust by the difference. This
 * converges within two passes for every real IANA zone (offsets are whole-minute and DST
 * shifts are at most a couple of hours, both far smaller than a correction pass can resolve).
 */
export function combineLocalDateTime(isoDate: string, hhmm: string, timezone: string): string {
  assertIsoDate(isoDate);
  assertHhMm(hhmm, "hhmm");
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const [hour, minute] = hhmm.split(":").map(Number) as [number, number];
  // The wall-clock reading we're trying to hit, encoded as a number by (mis)treating it as UTC
  // - never itself returned, just a fixed point of comparison for the guesses below.
  const targetMs = Date.UTC(year, month - 1, day, hour, minute);

  let guess = targetMs;
  for (let i = 0; i < 2; i++) {
    const shown = toLocalDateTime(new Date(guess).toISOString(), timezone);
    const [shownYear, shownMonth, shownDay] = shown.date.split("-").map(Number) as [number, number, number];
    const [shownHour, shownMinute] = shown.time.split(":").map(Number) as [number, number];
    // What the current guess actually displays as locally, encoded the same (mistreat-as-UTC) way.
    const shownMs = Date.UTC(shownYear, shownMonth - 1, shownDay, shownHour, shownMinute);
    const nextGuess = guess + (targetMs - shownMs);
    if (nextGuess === guess) break;
    guess = nextGuess;
  }
  return new Date(guess).toISOString();
}

/**
 * Resolves which business date a punch instant belongs to, given the shift boundary it was
 * punched against. Build spec section 9's worked example: a 5PM-2AM shift, login
 * 25-Sep-2026 17:00, logout 26-Sep-2026 02:00 - both must resolve to business date
 * 25-Sep-2026, never split at the calendar-day boundary.
 *
 * The rule: if the shift is overnight and the punch's local time is at-or-before the
 * shift's EndTime, it's the tail end of the *previous* calendar day's shift window, so the
 * business date rolls back one day. A non-overnight shift never adjusts - an out-of-window
 * stray punch (e.g. 00:30 against a 09:00-18:00 day shift) is safest left on its own calendar
 * date rather than guessed at. `endTime === "00:00"` also never adjusts, since a boundary
 * exactly at midnight is definitionally "the start of this calendar day", not a rollover.
 */
export function resolveBusinessDate(instantIso: string, timezone: string, boundary: OvernightBoundary): string {
  assertHhMm(boundary.endTime, "boundary.endTime");
  const { date, time } = toLocalDateTime(instantIso, timezone);
  const rollsBack = boundary.isOvernight && boundary.endTime !== "00:00" && time <= boundary.endTime;
  return rollsBack ? addDays(date, -1) : date;
}

/**
 * The company-wide (not-tied-to-any-specific-shift) business date "today" - what the Global
 * Filter Bar's date presets are relative to. `dayStartTime` is the
 * `business_day.timezone`/`business_day.start_time` configuration (section 9's "configurable
 * business day start"): with the seeded default of "00:00" this is identical to the plain
 * local calendar date; a later change (e.g. "06:00" for an overnight-heavy operation) rolls
 * anything before that cutoff back onto the previous business date.
 *
 * This is deliberately not implemented as `resolveBusinessDate(..., { endTime: dayStartTime,
 * isOvernight: true })`: that function's EndTime is *inclusive* (the tail instant AT EndTime
 * still belongs to the previous day, per the worked example above), whereas a day-start
 * cutoff is *exclusive* (the instant AT the cutoff is when the new business date begins, not
 * the last instant of the old one) - the two are genuinely different comparisons, not the
 * same rule wearing different config.
 */
export function resolveGlobalBusinessDate(instantIso: string, timezone: string, dayStartTime: string): string {
  assertHhMm(dayStartTime, "dayStartTime");
  const { date, time } = toLocalDateTime(instantIso, timezone);
  const rollsBack = dayStartTime !== "00:00" && time < dayStartTime;
  return rollsBack ? addDays(date, -1) : date;
}
