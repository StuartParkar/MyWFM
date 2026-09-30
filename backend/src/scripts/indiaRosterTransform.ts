/**
 * Pure parsing/classification for the India Team Roster xlsx shape - no DB,
 * no I/O, so it's cheap to unit test (see
 * backend/tests/indiaRosterTransform.test.ts), mirroring
 * orgHierarchyParser.ts's own "pure parsing" split. See the plan/PR
 * description for the source file's real structure and the confirmed
 * business rules (standard 9-hour shifts; EH = Extra Head, FO = Festival
 * Off) this module encodes.
 */

export interface DerivedShift {
  shiftCode: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
}

const MINUTES_PER_DAY = 24 * 60;
const STANDARD_SHIFT_MINUTES = 9 * 60;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(totalMinutes: number): string {
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

/**
 * A raw roster code (e.g. 700, 1600) is the shift's start time in 24h HHMM
 * form with no leading zero (700 = 07:00, 1600 = 16:00) - confirmed by the
 * business as always a standard 9-hour shift, so the end time and overnight
 * flag are a pure function of the start time, never a separate guess.
 */
export function deriveNineHourShift(rawCode: number): DerivedShift {
  if (!Number.isInteger(rawCode) || rawCode < 0 || rawCode > 2359 || rawCode % 100 > 59) {
    throw new Error(`"${rawCode}" is not a valid HHMM shift start code.`);
  }
  const startMinutes = Math.floor(rawCode / 100) * 60 + (rawCode % 100);
  const endMinutes = (startMinutes + STANDARD_SHIFT_MINUTES) % MINUTES_PER_DAY;
  const isOvernight = endMinutes <= startMinutes;
  return {
    shiftCode: `${pad2(Math.floor(startMinutes / 60))}-${pad2(Math.floor(endMinutes / 60))}`,
    startTime: minutesToHHMM(startMinutes),
    endTime: minutesToHHMM(endMinutes),
    isOvernight,
  };
}

export type DayCellClassification =
  | { kind: "SHIFT"; rawCode: number }
  | { kind: "WEEKLY_OFF" | "LEAVE" | "EXTRA_HEAD" | "FESTIVAL_OFF" }
  | { kind: "UNKNOWN"; raw: unknown };

const SPECIAL_CODES: Record<string, "WEEKLY_OFF" | "LEAVE" | "EXTRA_HEAD" | "FESTIVAL_OFF"> = {
  WO: "WEEKLY_OFF",
  L: "LEAVE",
  EH: "EXTRA_HEAD",
  FO: "FESTIVAL_OFF",
};

/**
 * A day cell is either a numeric shift-start code, one of the four known
 * special codes (case/whitespace-insensitive), or unrecognized. An
 * unrecognized value must never be silently dropped or guessed at - the
 * caller aborts the whole run on an UNKNOWN result.
 */
export function classifyDayCell(value: unknown): DayCellClassification {
  if (typeof value === "number") return { kind: "SHIFT", rawCode: value };
  if (typeof value === "string") {
    const trimmed = value.trim().toUpperCase();
    const special = SPECIAL_CODES[trimmed];
    if (special) return { kind: special };
    if (/^\d+$/.test(trimmed)) return { kind: "SHIFT", rawCode: Number(trimmed) };
  }
  return { kind: "UNKNOWN", raw: value };
}

/**
 * Columns 1-12 of a data row (Emp ID..Unit HOD) as trimmed strings, in the
 * exact order orgHierarchyParser.parseTsv expects. A genuinely blank cell
 * and a literal "-" both become "", which parseTsv's own normalizeNone
 * already turns into null - no new normalization rule is introduced here.
 */
export function employeeRowToTsvFields(cells: readonly unknown[]): string[] {
  return cells.map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ").trim());
}

export function employeeRowsToTsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.join("\t"), ...rows.map((row) => employeeRowToTsvFields(row).join("\t"))];
  return lines.join("\n");
}

/** The 7 date-header cells (columns 13-19) as real Date instances, returned as YYYY-MM-DD strings. */
export function extractBusinessDates(headerCells: readonly unknown[]): string[] {
  return headerCells.map((cell, i) => {
    if (!(cell instanceof Date)) {
      throw new Error(`Date header column ${i + 1} is not a date (got ${JSON.stringify(cell)}) - the source file's shape may have changed.`);
    }
    return cell.toISOString().slice(0, 10);
  });
}
