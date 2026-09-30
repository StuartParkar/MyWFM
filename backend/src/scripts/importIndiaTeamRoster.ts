import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { closePool, getPool, sql } from "../db/pool.js";
import { logger } from "../logger/logger.js";
import { getUserAuthProfile } from "../modules/auth/auth.repository.js";
import { recordAudit } from "../modules/audit/audit.service.js";
import { importEmployeeHierarchy } from "../modules/imports/orgHierarchyImporter.js";
import {
  classifyDayCell,
  deriveNineHourShift,
  employeeRowsToTsv,
  extractBusinessDates,
  type DayCellClassification,
} from "./indiaRosterTransform.js";

/**
 * One-off orchestrator for the real India Team Roster import (Sep/Oct 2026).
 * Reads the xlsx directly with the same exceljs pattern already used by
 * calls/callsImporter.ts's worksheetToObjects(), transforms the 12
 * employee/hierarchy columns into the exact TSV shape
 * orgHierarchyParser.parseTsv already expects and feeds them through the
 * existing, unmodified importEmployeeHierarchy(), creates the 17 real
 * 9-hour shifts, then writes every day cell (a real shift, Weekly Off,
 * Leave, Extra Head or Festival Off) directly to PublishedRoster as
 * already-decided operational fact (RosterRequirementId left NULL - this
 * data was never "submitted for approval" in the system, it already
 * happened, so simulating a submit/approve workflow after the fact would
 * misrepresent history, not record it - see documentation/imports.md's own
 * "Roster... populated by direct data entry" precedent).
 *
 * Usage: npm run import:india-roster --workspace=backend -- "<path to xlsx>" [actorEmail]
 */

const EXPECTED_EMPLOYEE_HEADER = [
  "Emp ID", "Name", "Alias Name", "Location", "Process", "Department",
  "SME", "Team Leader", "AM", "Manager", "Sr. Manager", "Unit HOD",
];

interface ParsedFile {
  employeeRows: unknown[][];
  businessDates: string[];
  dayCellsByRow: unknown[][];
}

async function readAndValidateWorkbook(filePath: string): Promise<ParsedFile> {
  const buffer = readFileSync(filePath);
  const workbook = new ExcelJS.Workbook();
  // exceljs/@types/node Buffer typing gap - same documented workaround as callsImporter.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error(`"${filePath}" has no worksheets.`);

  const headerRow = ws.getRow(2);
  const employeeHeader: string[] = [];
  for (let c = 1; c <= 12; c++) employeeHeader.push(String(headerRow.getCell(c).value ?? "").trim());
  for (let i = 0; i < EXPECTED_EMPLOYEE_HEADER.length; i++) {
    if (employeeHeader[i] !== EXPECTED_EMPLOYEE_HEADER[i]) {
      throw new Error(
        `Header column ${i + 1} is "${employeeHeader[i]}", expected "${EXPECTED_EMPLOYEE_HEADER[i]}" - ` +
          `the source file's shape has changed from what this script was built against.`,
      );
    }
  }
  const dateHeaderCells: unknown[] = [];
  for (let c = 13; c <= 19; c++) dateHeaderCells.push(headerRow.getCell(c).value);
  const businessDates = extractBusinessDates(dateHeaderCells);

  const employeeRows: unknown[][] = [];
  const dayCellsByRow: unknown[][] = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const empIdCell = row.getCell(1).value;
    if (empIdCell === null || empIdCell === undefined || empIdCell === "") continue; // trailing blank row
    const employeeCells: unknown[] = [];
    for (let c = 1; c <= 12; c++) employeeCells.push(row.getCell(c).value);
    employeeRows.push(employeeCells);
    const dayCells: unknown[] = [];
    for (let c = 13; c <= 19; c++) dayCells.push(row.getCell(c).value);
    dayCellsByRow.push(dayCells);
  }

  return { employeeRows, businessDates, dayCellsByRow };
}

/** classifyAllDayCells throws on any UNKNOWN before returning, so every classification it
 * actually hands back is guaranteed to exclude that case - reflected here at the type level
 * so callers don't need a redundant runtime re-check. */
type ValidatedDayCell = Exclude<DayCellClassification, { kind: "UNKNOWN" }>;

interface ClassifiedDay {
  empId: string;
  businessDate: string;
  classification: ValidatedDayCell;
}

function classifyAllDayCells(parsed: ParsedFile): ClassifiedDay[] {
  const out: ClassifiedDay[] = [];
  for (let i = 0; i < parsed.employeeRows.length; i++) {
    const empId = String(parsed.employeeRows[i]![0]);
    const dayCells = parsed.dayCellsByRow[i]!;
    for (let d = 0; d < parsed.businessDates.length; d++) {
      const classification = classifyDayCell(dayCells[d]);
      if (classification.kind === "UNKNOWN") {
        throw new Error(
          `Row for Emp ID ${empId}, date ${parsed.businessDates[d]}: unrecognized day-cell value ${JSON.stringify(classification.raw)}. ` +
            `Refusing to guess - fix the source file or extend classifyDayCell() deliberately, then re-run.`,
        );
      }
      out.push({ empId, businessDate: parsed.businessDates[d]!, classification });
    }
  }
  return out;
}

async function upsertShift(pool: import("mssql").ConnectionPool, code: string, startTime: string, endTime: string, isOvernight: boolean): Promise<number> {
  const result = await pool
    .request()
    .input("Code", sql.VarChar(20), code)
    .input("Start", sql.VarChar(5), startTime)
    .input("End", sql.VarChar(5), endTime)
    .input("Overnight", sql.Bit, isOvernight)
    .query<{ id: number }>(`
      MERGE [master].Shift AS target
      USING (SELECT @Code AS Code) AS source
      ON target.ShiftCode = source.Code
      WHEN NOT MATCHED THEN INSERT (ShiftCode, StartTime, EndTime, IsOvernight, Description)
        VALUES (@Code, @Start, @End, @Overnight, 'Imported from India Team Roster (9-hour standard shift)')
      OUTPUT INSERTED.ShiftId AS id;
    `);
  if (result.recordset[0]) return result.recordset[0].id;
  const existing = await pool.request().input("Code", sql.VarChar(20), code).query<{ id: number }>(`SELECT ShiftId AS id FROM [master].Shift WHERE ShiftCode = @Code`);
  return existing.recordset[0]!.id;
}

type DirectDayWrite =
  | { kind: "SHIFT"; shiftId: number }
  | { kind: "WEEKLY_OFF" }
  | { kind: "LEAVE" | "EXTRA_HEAD" | "FESTIVAL_OFF" };

/**
 * Writes one employee/day directly to PublishedRoster - real shift, Weekly
 * Off, Leave, Extra Head or Festival Off alike - as already-decided
 * operational fact (RosterRequirementId NULL: this was never submitted for
 * approval in the system, it already happened). Mirrors
 * roster.repository.ts's own publishRequirement() versioning discipline
 * (deactivate the previous active row, insert a new one with Version+1)
 * rather than ever overwriting a row in place. Idempotent: a re-run that
 * finds an identical active row for this employee/date is a no-op.
 */
async function upsertPublishedRosterDirect(
  pool: import("mssql").ConnectionPool,
  employeeId: string,
  businessDate: string,
  write: DirectDayWrite,
  publishedByUserId: string,
): Promise<boolean> {
  const shiftId = write.kind === "SHIFT" ? write.shiftId : null;
  const isWeeklyOff = write.kind === "WEEKLY_OFF";
  // WO is represented purely by IsWeeklyOff (unchanged, pre-existing column); DayType (added by
  // migration 0017) is only ever set for the 3 day-types the schema previously couldn't express.
  const dayType = write.kind === "LEAVE" || write.kind === "EXTRA_HEAD" || write.kind === "FESTIVAL_OFF" ? write.kind : null;

  const existing = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .input("BusinessDate", sql.Date, businessDate)
    .query<{ PublishedRosterId: number; Version: number; ShiftId: number | null; IsWeeklyOff: boolean; DayType: string | null }>(`
      SELECT PublishedRosterId, Version, ShiftId, IsWeeklyOff, DayType FROM [roster].PublishedRoster
      WHERE EmployeeId = @EmployeeId AND BusinessDate = @BusinessDate AND IsActive = 1
    `);
  const row = existing.recordset[0];
  if (row && row.ShiftId === shiftId && row.IsWeeklyOff === isWeeklyOff && row.DayType === dayType) return false; // re-run no-op

  if (row) {
    await pool.request().input("Id", sql.BigInt, row.PublishedRosterId).query(`UPDATE [roster].PublishedRoster SET IsActive = 0 WHERE PublishedRosterId = @Id`);
  }
  await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .input("BusinessDate", sql.Date, businessDate)
    .input("ShiftId", sql.Int, shiftId)
    .input("IsWeeklyOff", sql.Bit, isWeeklyOff)
    .input("DayType", sql.VarChar(20), dayType)
    .input("Version", sql.Int, (row?.Version ?? 0) + 1)
    .input("PublishedByUserId", sql.UniqueIdentifier, publishedByUserId)
    .query(`
      INSERT INTO [roster].PublishedRoster (EmployeeId, BusinessDate, ShiftId, IsWeeklyOff, DayType, Version, PublishedByUserId)
      VALUES (@EmployeeId, @BusinessDate, @ShiftId, @IsWeeklyOff, @DayType, @Version, @PublishedByUserId)
    `);
  return true;
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const actorEmail = process.argv[3] ?? "admin@mywfm.local";
  if (!filePath) {
    logger.critical({}, 'Usage: npm run import:india-roster --workspace=backend -- "<path to xlsx>" [actorEmail]');
    process.exitCode = 1;
    return;
  }

  // ---- Pass 1: read + validate everything, no writes yet ----
  const parsed = await readAndValidateWorkbook(filePath);
  logger.info({ employees: parsed.employeeRows.length, businessDates: parsed.businessDates }, "Parsed source file");
  const classifiedDays = classifyAllDayCells(parsed);
  logger.info({ totalDayCells: classifiedDays.length }, "Every day cell classified (no unknowns) - safe to write");

  const tsvText = employeeRowsToTsv(EXPECTED_EMPLOYEE_HEADER, parsed.employeeRows);

  const pool = await getPool();
  const actor = await getUserAuthProfile({ email: actorEmail });
  if (!actor) throw new Error(`Actor user "${actorEmail}" not found.`);

  // ---- Pass 2: writes, in dependency order ----

  // 1. Employees + hierarchy + Location/Process/Department master data - fully reused, unmodified.
  const hierarchyResult = await importEmployeeHierarchy(tsvText, {
    fileName: path.basename(filePath),
    fileSizeBytes: readFileSync(filePath).byteLength,
    uploadedByUserId: actor.userId,
  });
  logger.info(hierarchyResult, "Employee/org-hierarchy import complete");

  // 2. The 17 real 9-hour shifts.
  const rawCodes = new Set<number>();
  for (const day of classifiedDays) if (day.classification.kind === "SHIFT") rawCodes.add(day.classification.rawCode);
  const shiftIdByRawCode = new Map<number, number>();
  for (const rawCode of rawCodes) {
    const derived = deriveNineHourShift(rawCode);
    const shiftId = await upsertShift(pool, derived.shiftCode, derived.startTime, derived.endTime, derived.isOvernight);
    shiftIdByRawCode.set(rawCode, shiftId);
  }
  logger.info({ shiftCount: shiftIdByRawCode.size }, "Shift master data ready");

  // 3. Employee lookup - read back from the DB (EmployeeCode -> EmployeeId) rather than
  // re-deriving anything, so this agrees exactly with what importEmployeeHierarchy() just wrote.
  const employeeRows = await pool.request().query<{ EmployeeId: string; EmployeeCode: string }>(`SELECT EmployeeId, EmployeeCode FROM [master].Employee`);
  const employeeIdByCode = new Map(employeeRows.recordset.map((r) => [r.EmployeeCode, r.EmployeeId]));

  // 4. Every day cell, written directly to PublishedRoster as already-decided fact.
  const counts: Record<string, number> = { SHIFT: 0, WEEKLY_OFF: 0, LEAVE: 0, EXTRA_HEAD: 0, FESTIVAL_OFF: 0 };
  let skipped = 0;
  for (const day of classifiedDays) {
    const employeeId = employeeIdByCode.get(day.empId);
    if (!employeeId) throw new Error(`Emp ID ${day.empId} was classified but has no master.Employee row after import - this should be impossible.`);

    const write: DirectDayWrite =
      day.classification.kind === "SHIFT"
        ? { kind: "SHIFT", shiftId: shiftIdByRawCode.get(day.classification.rawCode)! }
        : { kind: day.classification.kind };

    const wrote = await upsertPublishedRosterDirect(pool, employeeId, day.businessDate, write, actor.userId);
    if (wrote) counts[write.kind] = (counts[write.kind] ?? 0) + 1;
    else skipped += 1;
  }
  await recordAudit({
    entityType: "PublishedRoster",
    action: "BULK_IMPORT_DIRECT_PUBLISH",
    performedByUserId: actor.userId,
    after: { sourceFile: path.basename(filePath), counts, skipped },
  });

  logger.info({ employees: parsed.employeeRows.length, shifts: shiftIdByRawCode.size, ...counts, skipped }, "India Team Roster import complete");
}

// Naive `file://${process.argv[1]}` string concatenation (the pattern already used by
// importOrgHierarchy.ts/importCalls.ts) never matches on Windows: import.meta.url uses forward
// slashes with a file:/// prefix, while process.argv[1] is the raw backslash path - confirmed
// directly, and it silently made main() never run at all rather than erroring. pathToFileURL
// normalizes both sides correctly on every platform.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main()
    .catch((err) => {
      logger.critical({ err }, "importIndiaTeamRoster failed");
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
