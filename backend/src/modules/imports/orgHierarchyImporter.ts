import { getConfigNumber } from "../../config/appConfig.js";
import { getPool, sql } from "../../db/pool.js";
import { logger } from "../../logger/logger.js";
import { recordAudit } from "../audit/audit.service.js";
import * as importRepo from "./import.repository.js";
import { parseTsv, type SourceRow } from "./orgHierarchyParser.js";

const MAPPING_VERSION = "ORGHIERARCHY-V1";

export interface OrgHierarchyImportResult {
  importRunId: number;
  importCode: string;
  recordsReceived: number;
  recordsAccepted: number;
  recordsRejected: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsDuplicate: number;
  /** Employees present in an earlier import but missing from this one - see build spec
   * section 22 / documentation/attrition.md. 0 whenever the missing fraction exceeded the
   * attrition.max_auto_exit_fraction safety threshold (a data-quality issue is raised instead). */
  recordsExited: number;
  /** A Department/Location/primary-Process change detected for an already-known employee. */
  recordsTransferred: number;
  dataQualityIssueCount: number;
}

export interface TransferCheckInput {
  wasInsert: boolean;
  oldDepartmentId: number | null;
  newDepartmentId: number | null;
  oldLocationId: number | null;
  newLocationId: number | null;
  oldPrimaryProcessId: number | null;
  newPrimaryProcessId: number | null;
}

/** A fresh INSERT is a join, never a transfer - only an already-known employee (matched on
 * EmployeeCode) can be "transferred." Exported standalone so this decision is unit-tested
 * without needing a mocked SQL pool - see documentation/attrition.md. */
export function isRealTransfer(input: TransferCheckInput): boolean {
  if (input.wasInsert) return false;
  return input.oldDepartmentId !== input.newDepartmentId || input.oldLocationId !== input.newLocationId || input.oldPrimaryProcessId !== input.newPrimaryProcessId;
}

/** True when the fraction of the current active roster missing from a re-import is large
 * enough that it's more likely a partial/wrong file than real mass attrition (build spec
 * section 22 / attrition.max_auto_exit_fraction) - in which case none of them should be
 * auto-marked exited. */
export function exceedsMassExitThreshold(missingCount: number, activeCount: number, maxAutoExitFraction: number): boolean {
  if (activeCount === 0) return false;
  return missingCount / activeCount > maxAutoExitFraction;
}

export interface ImportEmployeeHierarchyOptions {
  fileName: string;
  fileSizeBytes?: number;
  uploadedByUserId: string | null;
}

async function upsertLookup(table: string, codeCol: string, nameCol: string, code: string, name: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Code", sql.NVarChar(100), code)
    .input("Name", sql.NVarChar(200), name)
    .query<{ id: number }>(`
      MERGE [master].${table} AS target
      USING (SELECT @Code AS Code, @Name AS Name) AS source
      ON target.${codeCol} = source.Code
      WHEN NOT MATCHED THEN INSERT (${codeCol}, ${nameCol}) VALUES (source.Code, source.Name)
      OUTPUT INSERTED.${table}Id AS id;
    `);
  if (result.recordset[0]) return result.recordset[0].id;
  const existing = await pool
    .request()
    .input("Code", sql.NVarChar(100), code)
    .query<{ id: number }>(`SELECT ${table}Id AS id FROM [master].${table} WHERE ${codeCol} = @Code`);
  return existing.recordset[0]!.id;
}

async function upsertDepartment(name: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query<{ id: number }>(`
      MERGE [master].Department AS target
      USING (SELECT @Name AS Name) AS source
      ON target.DepartmentName = source.Name
      WHEN NOT MATCHED THEN INSERT (DepartmentName) VALUES (source.Name)
      OUTPUT INSERTED.DepartmentId AS id;
    `);
  if (result.recordset[0]) return result.recordset[0].id;
  const existing = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query<{ id: number }>(`SELECT DepartmentId AS id FROM [master].Department WHERE DepartmentName = @Name`);
  return existing.recordset[0]!.id;
}

/**
 * Runs the real org-hierarchy file (whatever was uploaded, or the fixed
 * sample via scripts/importOrgHierarchy.ts) through the generic Import
 * Center pipeline (build spec section 29): every call creates a real,
 * traceable import.ImportRun row and any anomaly becomes an
 * import.DataQualityIssue row, not a log line that scrolls away. See
 * imports/samples/master-data/README.md for the specific anomalies handled
 * below (TBA-* vacancies, alias trailing spaces, a multi-name leader cell,
 * blank-vs-dash nulls, intra-file duplicate employee codes).
 */
export async function importEmployeeHierarchy(text: string, opts: ImportEmployeeHierarchyOptions): Promise<OrgHierarchyImportResult> {
  const startedAt = Date.now();
  const importRunId = await importRepo.createImportRun({
    sourceSystem: "MASTER_DATA_EMPLOYEE_HIERARCHY",
    sourceType: "TSV",
    fileName: opts.fileName,
    fileSizeBytes: opts.fileSizeBytes,
    uploadedByUserId: opts.uploadedByUserId,
    mappingVersion: MAPPING_VERSION,
  });
  let dataQualityIssueCount = 0;
  const issue = async (input: Omit<Parameters<typeof importRepo.createDataQualityIssue>[0], "importRunId">) => {
    dataQualityIssueCount += 1;
    await importRepo.createDataQualityIssue({ ...input, importRunId });
  };
  // This run's own effective date for every join/exit/transfer it detects - never "today"
  // computed later, so every date this run writes agrees even if the run spans a slow moment.
  const effectiveDate = new Date().toISOString().slice(0, 10);

  try {
    const allRows = parseTsv(text);
    const recordsReceived = allRows.length;

    await importRepo.setImportRunStatus(importRunId, "VALIDATING");
    const validated: SourceRow[] = [];
    let recordsRejected = 0;
    for (const row of allRows) {
      if (!row.employeeCode || !row.fullName) {
        recordsRejected += 1;
        await issue({
          severity: "HIGH",
          issueType: "MISSING_REQUIRED_FIELD",
          recordReference: row.employeeCode || "(unknown)",
          description: "Row is missing Emp ID or Name.",
          suggestedAction: "Fix the source row and re-upload.",
        });
        continue;
      }
      validated.push(row);
    }

    await importRepo.setImportRunStatus(importRunId, "DUPLICATE_CHECK");
    const seenCodes = new Set<string>();
    const rows: SourceRow[] = [];
    let recordsDuplicate = 0;
    for (const row of validated) {
      if (seenCodes.has(row.employeeCode)) {
        recordsDuplicate += 1;
        await issue({
          severity: "MEDIUM",
          issueType: "DUPLICATE_ROW",
          recordReference: row.employeeCode,
          description: `Emp ID ${row.employeeCode} appears more than once in this file - only the first occurrence was used.`,
          suggestedAction: "Remove the duplicate row from the source file.",
        });
        continue;
      }
      seenCodes.add(row.employeeCode);
      rows.push(row);
    }

    await importRepo.setImportRunStatus(importRunId, "NORMALIZING");
    const locationIdByCode = new Map<string, number>();
    const departmentIdByName = new Map<string, number>();
    const processIdByCode = new Map<string, number>();
    for (const row of rows) {
      if (row.locationCode && !locationIdByCode.has(row.locationCode)) {
        locationIdByCode.set(row.locationCode, await upsertLookup("Location", "LocationCode", "LocationName", row.locationCode, row.locationCode));
      }
      if (row.departmentName && !departmentIdByName.has(row.departmentName)) {
        departmentIdByName.set(row.departmentName, await upsertDepartment(row.departmentName));
      }
      for (const code of row.processCodes) {
        if (!processIdByCode.has(code)) {
          processIdByCode.set(code, await upsertLookup("Process", "ProcessCode", "ProcessName", code, code));
        }
      }
    }

    const pool = await getPool();
    const employeeIdByCode = new Map<string, string>();
    // Old Department/Location (from the MERGE's own OUTPUT DELETED.* - NULL for a fresh INSERT,
    // meaningless there anyway since a brand-new employee has no "transfer," only a join) plus
    // old primary Process (fetched below, before that separate table is touched) feed the
    // transfer-detection pass once every row has been processed.
    interface TransferCandidate {
      employeeId: string;
      oldDepartmentId: number | null;
      newDepartmentId: number | null;
      oldLocationId: number | null;
      newLocationId: number | null;
      oldPrimaryProcessId: number | null;
      newPrimaryProcessId: number | null;
      wasInsert: boolean;
    }
    const transferCandidates = new Map<string, TransferCandidate>();
    let recordsInserted = 0;
    let recordsUpdated = 0;

    for (const row of rows) {
      const newDepartmentId = row.departmentName ? (departmentIdByName.get(row.departmentName) ?? null) : null;
      const newLocationId = row.locationCode ? (locationIdByCode.get(row.locationCode) ?? null) : null;
      const result = await pool
        .request()
        .input("EmployeeCode", sql.VarChar(20), row.employeeCode)
        .input("FullName", sql.NVarChar(200), row.fullName)
        .input("AliasName", sql.NVarChar(100), row.aliasName)
        .input("LocationId", sql.Int, newLocationId)
        .input("DepartmentId", sql.Int, newDepartmentId)
        .input("JoinDate", sql.Date, effectiveDate)
        .query<{ EmployeeId: string; Action: string; OldDepartmentId: number | null; OldLocationId: number | null }>(`
          MERGE [master].Employee AS target
          USING (SELECT @EmployeeCode AS EmployeeCode) AS source
          ON target.EmployeeCode = source.EmployeeCode
          WHEN MATCHED THEN UPDATE SET
            FullName = @FullName, AliasName = @AliasName, LocationId = @LocationId, DepartmentId = @DepartmentId, ModifiedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            -- JoinDate is this run's own effective date - the real (if imprecise) fact of when
            -- this system first learned about this employee, never overwritten on later
            -- updates and never touched at all if a real HR date is later entered manually
            -- (Admin > Employees) - see documentation/attrition.md.
            INSERT (EmployeeCode, FullName, AliasName, LocationId, DepartmentId, JoinDate)
            VALUES (@EmployeeCode, @FullName, @AliasName, @LocationId, @DepartmentId, @JoinDate)
          OUTPUT $action AS Action, INSERTED.EmployeeId AS EmployeeId,
                 DELETED.DepartmentId AS OldDepartmentId, DELETED.LocationId AS OldLocationId;
        `);
      const row0 = result.recordset[0]!;
      employeeIdByCode.set(row.employeeCode, row0.EmployeeId);
      const wasInsert = row0.Action === "INSERT";
      if (wasInsert) recordsInserted += 1;
      else recordsUpdated += 1;
      transferCandidates.set(row0.EmployeeId, { employeeId: row0.EmployeeId, oldDepartmentId: row0.OldDepartmentId, newDepartmentId, oldLocationId: row0.OldLocationId, newLocationId, oldPrimaryProcessId: null, newPrimaryProcessId: null, wasInsert });
    }

    for (const row of rows) {
      const employeeId = employeeIdByCode.get(row.employeeCode)!;
      const oldPrimary = await pool
        .request()
        .input("EmployeeId", sql.UniqueIdentifier, employeeId)
        .query<{ ProcessId: number }>(`SELECT ProcessId FROM [master].EmployeeProcess WHERE EmployeeId = @EmployeeId AND IsPrimary = 1`);
      const oldPrimaryProcessId = oldPrimary.recordset[0]?.ProcessId ?? null;

      await pool.request().input("EmployeeId", sql.UniqueIdentifier, employeeId).query(
        `DELETE FROM [master].EmployeeProcess WHERE EmployeeId = @EmployeeId`,
      );
      for (const [i, code] of row.processCodes.entries()) {
        await pool
          .request()
          .input("EmployeeId", sql.UniqueIdentifier, employeeId)
          .input("ProcessId", sql.Int, processIdByCode.get(code))
          .input("IsPrimary", sql.Bit, i === 0)
          .query(`INSERT INTO [master].EmployeeProcess (EmployeeId, ProcessId, IsPrimary) VALUES (@EmployeeId, @ProcessId, @IsPrimary)`);
      }
      const newPrimaryProcessId = row.processCodes.length > 0 ? (processIdByCode.get(row.processCodes[0]!) ?? null) : null;
      transferCandidates.set(employeeId, { ...transferCandidates.get(employeeId)!, oldPrimaryProcessId, newPrimaryProcessId });
    }

    // A Department/Location/primary-Process change has no history anywhere else - see
    // migration 0014_attrition.sql's header comment. Only for an already-known employee (an
    // INSERT is a join, not a transfer) and only when something actually differs.
    let recordsTransferred = 0;
    for (const candidate of transferCandidates.values()) {
      if (!isRealTransfer(candidate)) continue;

      await pool
        .request()
        .input("EmployeeId", sql.UniqueIdentifier, candidate.employeeId)
        .input("EffectiveDate", sql.Date, effectiveDate)
        .input("PreviousDepartmentId", sql.Int, candidate.oldDepartmentId)
        .input("NewDepartmentId", sql.Int, candidate.newDepartmentId)
        .input("PreviousLocationId", sql.Int, candidate.oldLocationId)
        .input("NewLocationId", sql.Int, candidate.newLocationId)
        .input("PreviousPrimaryProcessId", sql.Int, candidate.oldPrimaryProcessId)
        .input("NewPrimaryProcessId", sql.Int, candidate.newPrimaryProcessId)
        .input("SourceImportRunId", sql.BigInt, importRunId)
        .query(`
          INSERT INTO [master].EmployeeTransfer
            (EmployeeId, EffectiveDate, PreviousDepartmentId, NewDepartmentId, PreviousLocationId, NewLocationId, PreviousPrimaryProcessId, NewPrimaryProcessId, SourceImportRunId)
          VALUES
            (@EmployeeId, @EffectiveDate, @PreviousDepartmentId, @NewDepartmentId, @PreviousLocationId, @NewLocationId, @PreviousPrimaryProcessId, @NewPrimaryProcessId, @SourceImportRunId)
        `);
      recordsTransferred += 1;
    }

    // Exits: this file is a full roster snapshot, so a currently-active employee simply absent
    // from it has left - but only within a sane fraction of the current roster (see
    // attrition.max_auto_exit_fraction's own seed-data comment); a bigger absence is far more
    // likely a partial/wrong file than real mass attrition, so it becomes a review item instead
    // of a silent mass deactivation.
    const activeResult = await pool.request().query<{ EmployeeId: string; EmployeeCode: string }>(
      `SELECT EmployeeId, EmployeeCode FROM [master].Employee WHERE IsActive = 1`,
    );
    const seenEmployeeCodes = new Set(rows.map((r) => r.employeeCode));
    const missingEmployees = activeResult.recordset.filter((e) => !seenEmployeeCodes.has(e.EmployeeCode));
    const maxAutoExitFraction = getConfigNumber("attrition.max_auto_exit_fraction", 0.2);
    let recordsExited = 0;
    if (missingEmployees.length > 0) {
      if (exceedsMassExitThreshold(missingEmployees.length, activeResult.recordset.length, maxAutoExitFraction)) {
        const missingFraction = missingEmployees.length / activeResult.recordset.length;
        await issue({
          severity: "HIGH",
          issueType: "MASS_EMPLOYEE_ABSENCE",
          description: `${missingEmployees.length} of ${activeResult.recordset.length} currently-active employees (${Math.round(missingFraction * 100)}%) are missing from this file - over the configured ${Math.round(maxAutoExitFraction * 100)}% safety threshold, so none were marked exited.`,
          suggestedAction: "Confirm this file is the complete current roster before re-uploading. If this many real exits happened at once, set each employee's Left Date via Admin > Employees, or raise attrition.max_auto_exit_fraction in Configuration first.",
        });
      } else {
        for (const emp of missingEmployees) {
          await pool
            .request()
            .input("EmployeeId", sql.UniqueIdentifier, emp.EmployeeId)
            .input("LeftDate", sql.Date, effectiveDate)
            .query(`UPDATE [master].Employee SET IsActive = 0, LeftDate = @LeftDate, ModifiedAt = SYSUTCDATETIME() WHERE EmployeeId = @EmployeeId AND LeftDate IS NULL`);
          recordsExited += 1;
        }
      }
    }

    await importRepo.setImportRunStatus(importRunId, "DATA_QUALITY");
    const employeeIdByAlias = new Map<string, string>();
    for (const row of rows) {
      if (!row.aliasName) continue;
      const key = row.aliasName.toLowerCase();
      if (employeeIdByAlias.has(key)) {
        await issue({
          severity: "MEDIUM",
          issueType: "DUPLICATE_ALIAS",
          recordReference: row.employeeCode,
          description: `Alias "${row.aliasName}" is used by more than one employee - the first occurrence wins for hierarchy resolution.`,
          suggestedAction: "Give each employee a unique alias in the source system.",
        });
        continue;
      }
      employeeIdByAlias.set(key, employeeIdByCode.get(row.employeeCode)!);
    }

    async function resolveAlias(raw: string | null, column: string, employeeCode: string): Promise<{ employeeId: string | null; vacantLabel: string | null }> {
      if (!raw) return { employeeId: null, vacantLabel: null };
      if (raw.startsWith("TBA-")) {
        await issue({
          severity: "LOW",
          issueType: "VACANT_LEADER_PLACEHOLDER",
          recordReference: employeeCode,
          description: `${column} is a vacant placeholder ("${raw}"), not a real employee.`,
          suggestedAction: "Informational only - fill the position in the source system when it's assigned.",
        });
        return { employeeId: null, vacantLabel: column === "teamLeader" ? raw : null };
      }
      let candidate = raw;
      if (raw.includes("/")) {
        const [first, ...rest] = raw.split("/").map((s) => s.trim());
        await issue({
          severity: "MEDIUM",
          issueType: "MULTI_VALUE_CELL",
          recordReference: employeeCode,
          description: `${column} cell "${raw}" names more than one person - used "${first}", dropped ${rest.join(", ")}.`,
          suggestedAction: "Split into one clear leader per source row.",
        });
        candidate = first!;
      }
      const resolved = employeeIdByAlias.get(candidate.toLowerCase());
      if (!resolved) {
        await issue({
          severity: "HIGH",
          issueType: "UNRESOLVED_LEADER_ALIAS",
          recordReference: employeeCode,
          description: `${column} alias "${candidate}" does not match any known employee.`,
          suggestedAction: "Check for a typo, or add the missing employee row.",
        });
        return { employeeId: null, vacantLabel: null };
      }
      return { employeeId: resolved, vacantLabel: null };
    }

    for (const row of rows) {
      const employeeId = employeeIdByCode.get(row.employeeCode)!;
      const sme = await resolveAlias(row.sme, "sme", row.employeeCode);
      const teamLeader = await resolveAlias(row.teamLeader, "teamLeader", row.employeeCode);
      const am = await resolveAlias(row.am, "am", row.employeeCode);
      const manager = await resolveAlias(row.manager, "manager", row.employeeCode);
      const srManager = await resolveAlias(row.srManager, "srManager", row.employeeCode);
      const unitHod = await resolveAlias(row.unitHod, "unitHod", row.employeeCode);

      await pool
        .request()
        .input("EmployeeId", sql.UniqueIdentifier, employeeId)
        .input("SmeEmployeeId", sql.UniqueIdentifier, sme.employeeId)
        .input("TeamLeaderEmployeeId", sql.UniqueIdentifier, teamLeader.employeeId)
        .input("AmEmployeeId", sql.UniqueIdentifier, am.employeeId)
        .input("ManagerEmployeeId", sql.UniqueIdentifier, manager.employeeId)
        .input("SrManagerEmployeeId", sql.UniqueIdentifier, srManager.employeeId)
        .input("UnitHodEmployeeId", sql.UniqueIdentifier, unitHod.employeeId)
        .input("VacantTeamLeaderLabel", sql.NVarChar(50), teamLeader.vacantLabel)
        .query(`
          UPDATE [master].Employee
          SET SmeEmployeeId = @SmeEmployeeId, TeamLeaderEmployeeId = @TeamLeaderEmployeeId, AmEmployeeId = @AmEmployeeId,
              ManagerEmployeeId = @ManagerEmployeeId, SrManagerEmployeeId = @SrManagerEmployeeId, UnitHodEmployeeId = @UnitHodEmployeeId,
              VacantTeamLeaderLabel = @VacantTeamLeaderLabel, ModifiedAt = SYSUTCDATETIME()
          WHERE EmployeeId = @EmployeeId
        `);
    }

    await importRepo.setImportRunStatus(importRunId, "MERGING");
    await pool.request().query(`
      ;WITH Referenced AS (
        SELECT SmeEmployeeId AS EmployeeId, 1 AS Level FROM [master].Employee WHERE SmeEmployeeId IS NOT NULL
        UNION ALL SELECT TeamLeaderEmployeeId, 2 FROM [master].Employee WHERE TeamLeaderEmployeeId IS NOT NULL
        UNION ALL SELECT AmEmployeeId, 3 FROM [master].Employee WHERE AmEmployeeId IS NOT NULL
        UNION ALL SELECT ManagerEmployeeId, 4 FROM [master].Employee WHERE ManagerEmployeeId IS NOT NULL
        UNION ALL SELECT SrManagerEmployeeId, 5 FROM [master].Employee WHERE SrManagerEmployeeId IS NOT NULL
        UNION ALL SELECT UnitHodEmployeeId, 6 FROM [master].Employee WHERE UnitHodEmployeeId IS NOT NULL
      ),
      HighestLevel AS (
        SELECT EmployeeId, MAX(Level) AS Level FROM Referenced GROUP BY EmployeeId
      )
      UPDATE e
      SET DesignationId = d.DesignationId, ModifiedAt = SYSUTCDATETIME()
      FROM [master].Employee e
      LEFT JOIN HighestLevel h ON h.EmployeeId = e.EmployeeId
      JOIN [master].Designation d ON d.HierarchyLevel = ISNULL(h.Level, 0);
    `);

    const counts: importRepo.ImportRunCounts = {
      recordsReceived,
      recordsAccepted: rows.length,
      recordsRejected,
      recordsInserted,
      recordsUpdated,
      recordsDuplicate,
    };
    await importRepo.completeImportRun(importRunId, counts, startedAt);

    await recordAudit({
      entityType: "Employee",
      action: "MASTER_DATA_IMPORT",
      referenceId: `IMPORT-${String(importRunId).padStart(8, "0")}`,
      after: { ...counts, recordsExited, recordsTransferred },
      reason: `imported from ${opts.fileName}`,
    });

    logger.info({ importRunId, ...counts, recordsExited, recordsTransferred, dataQualityIssueCount }, "Org hierarchy import complete");
    return { importRunId, importCode: `IMPORT-${String(importRunId).padStart(8, "0")}`, ...counts, recordsExited, recordsTransferred, dataQualityIssueCount };
  } catch (err) {
    await importRepo.setImportRunStatus(importRunId, "FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
