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
  dataQualityIssueCount: number;
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
    let recordsInserted = 0;
    let recordsUpdated = 0;

    for (const row of rows) {
      const result = await pool
        .request()
        .input("EmployeeCode", sql.VarChar(20), row.employeeCode)
        .input("FullName", sql.NVarChar(200), row.fullName)
        .input("AliasName", sql.NVarChar(100), row.aliasName)
        .input("LocationId", sql.Int, row.locationCode ? locationIdByCode.get(row.locationCode) : null)
        .input("DepartmentId", sql.Int, row.departmentName ? departmentIdByName.get(row.departmentName) : null)
        .query<{ EmployeeId: string; Action: string }>(`
          MERGE [master].Employee AS target
          USING (SELECT @EmployeeCode AS EmployeeCode) AS source
          ON target.EmployeeCode = source.EmployeeCode
          WHEN MATCHED THEN UPDATE SET
            FullName = @FullName, AliasName = @AliasName, LocationId = @LocationId, DepartmentId = @DepartmentId, ModifiedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (EmployeeCode, FullName, AliasName, LocationId, DepartmentId)
            VALUES (@EmployeeCode, @FullName, @AliasName, @LocationId, @DepartmentId)
          OUTPUT $action AS Action, INSERTED.EmployeeId AS EmployeeId;
        `);
      const row0 = result.recordset[0]!;
      employeeIdByCode.set(row.employeeCode, row0.EmployeeId);
      if (row0.Action === "INSERT") recordsInserted += 1;
      else recordsUpdated += 1;
    }

    for (const row of rows) {
      const employeeId = employeeIdByCode.get(row.employeeCode)!;
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
      after: counts,
      reason: `imported from ${opts.fileName}`,
    });

    logger.info({ importRunId, ...counts, dataQualityIssueCount }, "Org hierarchy import complete");
    return { importRunId, importCode: `IMPORT-${String(importRunId).padStart(8, "0")}`, ...counts, dataQualityIssueCount };
  } catch (err) {
    await importRepo.setImportRunStatus(importRunId, "FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
