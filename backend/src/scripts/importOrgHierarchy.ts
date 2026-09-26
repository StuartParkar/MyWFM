import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, sql, closePool } from "../db/pool.js";
import { recordAudit } from "../modules/audit/audit.service.js";
import { logger } from "../logger/logger.js";

/**
 * One-time (re-runnable) loader for the real org-hierarchy sample the
 * business owner provided in chat - see imports/samples/master-data/README.md
 * for the full provenance and data-quality notes this script implements:
 *
 *  - hierarchy is encoded by Alias Name, not Emp ID - resolved via an
 *    alias -> EmployeeId map built after every employee row is inserted
 *  - "TBA-*" leader values are vacant placeholders, not employees
 *  - blank and "-" both mean "none"
 *  - Process can hold a combined value ("ABS/LBF") - modelled as multiple
 *    EmployeeProcess rows, not a literal combined Process row
 *  - a leader column can (rarely) hold multiple names ("Will/Rowen") - the
 *    first is used and the rest logged as a data-quality warning
 *
 * This is a narrow, one-dataset script, not the general Import Center
 * (that's Phase 3) - but it follows the same discipline: never silently
 * drop an anomaly, always log it.
 *
 * Usage: npm run import:org-hierarchy --workspace=backend
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSV_PATH = path.resolve(__dirname, "../../../imports/samples/master-data/employee-org-hierarchy-2026-09-26.tsv");

export interface SourceRow {
  employeeCode: string;
  fullName: string;
  aliasName: string | null;
  locationCode: string | null;
  processCodes: string[];
  departmentName: string | null;
  sme: string | null;
  teamLeader: string | null;
  am: string | null;
  manager: string | null;
  srManager: string | null;
  unitHod: string | null;
}

export function normalizeNone(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

export function parseTsv(text: string): SourceRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const [, ...dataLines] = lines; // skip header
  return dataLines.map((line) => {
    const cols = line.split("\t");
    const processRaw = normalizeNone(cols[4]);
    return {
      employeeCode: (cols[0] ?? "").trim(),
      fullName: (cols[1] ?? "").trim(),
      aliasName: normalizeNone(cols[2]),
      locationCode: normalizeNone(cols[3]),
      processCodes: processRaw ? processRaw.split("/").map((p) => p.trim()).filter(Boolean) : [],
      departmentName: normalizeNone(cols[5]),
      sme: normalizeNone(cols[6]),
      teamLeader: normalizeNone(cols[7]),
      am: normalizeNone(cols[8]),
      manager: normalizeNone(cols[9]),
      srManager: normalizeNone(cols[10]),
      unitHod: normalizeNone(cols[11]),
    };
  });
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

async function main(): Promise<void> {
  const text = readFileSync(TSV_PATH, "utf8");
  const rows = parseTsv(text);
  logger.info({ count: rows.length, file: TSV_PATH }, "Parsed org hierarchy source rows");

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
  logger.info(
    { locations: locationIdByCode.size, departments: departmentIdByName.size, processes: processIdByCode.size },
    "Upserted lookup master data",
  );

  const pool = await getPool();
  const employeeIdByCode = new Map<string, string>();

  // Pass 1: upsert every employee row (no leader FKs yet - not all rows inserted).
  for (const row of rows) {
    const result = await pool
      .request()
      .input("EmployeeCode", sql.VarChar(20), row.employeeCode)
      .input("FullName", sql.NVarChar(200), row.fullName)
      .input("AliasName", sql.NVarChar(100), row.aliasName)
      .input("LocationId", sql.Int, row.locationCode ? locationIdByCode.get(row.locationCode) : null)
      .input("DepartmentId", sql.Int, row.departmentName ? departmentIdByName.get(row.departmentName) : null)
      .query<{ EmployeeId: string }>(`
        MERGE [master].Employee AS target
        USING (SELECT @EmployeeCode AS EmployeeCode) AS source
        ON target.EmployeeCode = source.EmployeeCode
        WHEN MATCHED THEN UPDATE SET
          FullName = @FullName, AliasName = @AliasName, LocationId = @LocationId, DepartmentId = @DepartmentId, ModifiedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (EmployeeCode, FullName, AliasName, LocationId, DepartmentId)
          VALUES (@EmployeeCode, @FullName, @AliasName, @LocationId, @DepartmentId)
        OUTPUT INSERTED.EmployeeId AS EmployeeId;
      `);
    employeeIdByCode.set(row.employeeCode, result.recordset[0]!.EmployeeId);
  }
  logger.info({ count: employeeIdByCode.size }, "Upserted employee rows (pass 1 - no hierarchy yet)");

  // EmployeeProcess (delete + reinsert per employee - simplest correct idempotency here).
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

  // Alias -> EmployeeId map (case-insensitive, trimmed - source has trailing-space
  // inconsistencies like "Kam " vs "Kam").
  const employeeIdByAlias = new Map<string, string>();
  const aliasCollisions: string[] = [];
  for (const row of rows) {
    if (!row.aliasName) continue;
    const key = row.aliasName.toLowerCase();
    if (employeeIdByAlias.has(key)) {
      aliasCollisions.push(row.aliasName);
      continue;
    }
    employeeIdByAlias.set(key, employeeIdByCode.get(row.employeeCode)!);
  }
  if (aliasCollisions.length > 0) {
    logger.warn({ aliasCollisions }, "Duplicate alias names in source data - first occurrence wins for hierarchy resolution");
  }

  function resolveAlias(raw: string | null, column: string, employeeCode: string): { employeeId: string | null; vacantLabel: string | null } {
    if (!raw) return { employeeId: null, vacantLabel: null };
    if (raw.startsWith("TBA-")) {
      return { employeeId: null, vacantLabel: column === "teamLeader" ? raw : null };
    }
    let candidate = raw;
    if (raw.includes("/")) {
      const [first, ...rest] = raw.split("/").map((s) => s.trim());
      logger.warn({ employeeCode, column, raw, using: first, dropped: rest }, "Multiple names in one leader column - using the first");
      candidate = first!;
    }
    const resolved = employeeIdByAlias.get(candidate.toLowerCase());
    if (!resolved) {
      logger.warn({ employeeCode, column, raw: candidate }, "Could not resolve leader alias to a known employee");
      return { employeeId: null, vacantLabel: null };
    }
    return { employeeId: resolved, vacantLabel: null };
  }

  // Pass 2: resolve and write the hierarchy FKs now that every employee exists.
  for (const row of rows) {
    const employeeId = employeeIdByCode.get(row.employeeCode)!;
    const sme = resolveAlias(row.sme, "sme", row.employeeCode);
    const teamLeader = resolveAlias(row.teamLeader, "teamLeader", row.employeeCode);
    const am = resolveAlias(row.am, "am", row.employeeCode);
    const manager = resolveAlias(row.manager, "manager", row.employeeCode);
    const srManager = resolveAlias(row.srManager, "srManager", row.employeeCode);
    const unitHod = resolveAlias(row.unitHod, "unitHod", row.employeeCode);

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
  logger.info({}, "Resolved and wrote hierarchy FKs (pass 2)");

  // Derive each employee's own designation from the highest level at which
  // their EmployeeId is referenced as someone else's leader (see
  // database/seed-data/0003_designations.sql).
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
  logger.info({}, "Derived employee designations from hierarchy references");

  await recordAudit({
    entityType: "Employee",
    action: "MASTER_DATA_IMPORT",
    referenceId: path.basename(TSV_PATH),
    after: { rowCount: rows.length, aliasCollisions: aliasCollisions.length },
    reason: "imported via backend/src/scripts/importOrgHierarchy.ts",
  });

  logger.info({ employees: rows.length }, "Org hierarchy import complete");
}

// Guard so vitest (or anything else) can import parseTsv/normalizeNone for
// unit testing without triggering the real DB-writing import as a side effect.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main()
    .catch((err) => {
      logger.critical({ err }, "importOrgHierarchy failed");
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
