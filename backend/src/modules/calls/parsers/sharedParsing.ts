import { combineLocalDateTimeSeconds } from "@mywfm/shared";

export interface WallClock {
  isoDate: string;
  hhmmss: string;
}

/**
 * Vonage and RingCentral both export some rows with a genuinely string-typed date/time cell
 * (not a parsed Excel date) in "M/D/YYYY H:MM:SS AM/PM" - inspected directly against the real
 * sample files, not assumed; the hour is not always zero-padded (RingCentral's "9:54:55 PM").
 */
const US_DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;

export function parseUsDateTimeString(raw: string): WallClock | null {
  const m = US_DATETIME_RE.exec(raw.trim());
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min, ss, ampm] = m as unknown as [string, string, string, string, string, string, string, string];
  let hour = Number(hh) % 12;
  if (ampm.toUpperCase() === "PM") hour += 12;
  return {
    isoDate: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`,
    hhmmss: `${String(hour).padStart(2, "0")}:${min}:${ss}`,
  };
}

/**
 * A date/time cell that may come through as a genuine `Date` (exceljs parsed it, and
 * represents the parsed components in UTC getters regardless of the workbook's own timezone -
 * verified directly against the real sample files) or as a raw string in the format above -
 * both real, coexisting possibilities in the same column of the same file. Returns the
 * wall-clock components with no timezone applied yet; the source is naive about timezone, so
 * the caller combines the result with whichever zone that specific phone system uses
 * (see documentation/phone-system-mapping.md).
 */
export function cellToWallClock(value: unknown): WallClock | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const mo = value.getUTCMonth() + 1;
    const d = value.getUTCDate();
    const h = value.getUTCHours();
    const mi = value.getUTCMinutes();
    const s = value.getUTCSeconds();
    return {
      isoDate: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      hhmmss: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    };
  }
  if (typeof value === "string") return parseUsDateTimeString(value);
  return null;
}

export function wallClockToInstant(wallClock: WallClock | null, timezone: string): string | null {
  if (!wallClock) return null;
  return combineLocalDateTimeSeconds(wallClock.isoDate, wallClock.hhmmss, timezone);
}

/**
 * An Excel TIME-of-day cell (exceljs represents these as a `Date` on the 1899-12-30 epoch,
 * confirmed against the real sample files - e.g. Vonage's Talk Time/Wait Time, RingCentral's
 * Call Length/Handle Time) or a plain number already in seconds (Elevate's own duration
 * columns are pre-converted numbers, not time-formatted cells) - both real, source-specific
 * representations of "a duration", never assumed to be one or the other.
 */
export function cellToSeconds(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Math.round(value);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds();
  }
  return null;
}

export function cellToTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Adds whole seconds to an ISO instant, returning a new ISO instant. */
export function addSeconds(instantIso: string, seconds: number): string {
  return new Date(new Date(instantIso).getTime() + seconds * 1000).toISOString();
}
