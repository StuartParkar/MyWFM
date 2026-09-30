import { getPool, sql } from "../../db/pool.js";

export interface DimensionFilters {
  departmentId?: number;
  processId?: number;
  locationId?: number;
  designationId?: number;
}

/**
 * Every count below filters by an employee's *current* Department/Location/Designation and
 * *current* primary Process (master.EmployeeProcess.IsPrimary = 1) - the same simplification
 * Workforce Planning's own Current HC already makes (documentation/workforce.md): this system
 * has no historical point-in-time snapshot of "what was employee X's department on date Y,"
 * only the discrete master.EmployeeTransfer change log. An employee who transferred out of a
 * process after a historical period counts under their new process for that period's numbers,
 * not their process at the time - see documentation/attrition.md.
 */
const EMPLOYEE_DIMENSION_FILTER = `
  (@DepartmentId IS NULL OR e.DepartmentId = @DepartmentId)
  AND (@LocationId IS NULL OR e.LocationId = @LocationId)
  AND (@DesignationId IS NULL OR e.DesignationId = @DesignationId)
  AND (@ProcessId IS NULL OR EXISTS (SELECT 1 FROM [master].EmployeeProcess ep WHERE ep.EmployeeId = e.EmployeeId AND ep.IsPrimary = 1 AND ep.ProcessId = @ProcessId))
`;

/** Headcount active as of a single instant: JoinDate before/at it and not yet left. Used for
 * both Opening HC (asOfDate = the period's own start, exclusive of that day) and Closing HC
 * (asOfDate = the period's own end, inclusive). */
export async function getHeadcountAsOf(asOfDate: string, inclusive: boolean, filters: DimensionFilters): Promise<number> {
  const pool = await getPool();
  const joinComparison = inclusive ? "<=" : "<";
  const leftComparison = inclusive ? ">" : ">=";
  const result = await pool
    .request()
    .input("AsOfDate", sql.Date, asOfDate)
    .input("DepartmentId", sql.Int, filters.departmentId ?? null)
    .input("LocationId", sql.Int, filters.locationId ?? null)
    .input("DesignationId", sql.Int, filters.designationId ?? null)
    .input("ProcessId", sql.Int, filters.processId ?? null)
    .query<{ Cnt: number }>(`
      SELECT COUNT(*) AS Cnt
      FROM [master].Employee e
      WHERE e.JoinDate ${joinComparison} @AsOfDate AND (e.LeftDate IS NULL OR e.LeftDate ${leftComparison} @AsOfDate)
        AND ${EMPLOYEE_DIMENSION_FILTER}
    `);
  return result.recordset[0]?.Cnt ?? 0;
}

export async function getJoinersCount(from: string, to: string, filters: DimensionFilters): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .input("DepartmentId", sql.Int, filters.departmentId ?? null)
    .input("LocationId", sql.Int, filters.locationId ?? null)
    .input("DesignationId", sql.Int, filters.designationId ?? null)
    .input("ProcessId", sql.Int, filters.processId ?? null)
    .query<{ Cnt: number }>(`SELECT COUNT(*) AS Cnt FROM [master].Employee e WHERE e.JoinDate BETWEEN @From AND @To AND ${EMPLOYEE_DIMENSION_FILTER}`);
  return result.recordset[0]?.Cnt ?? 0;
}

export async function getExitsCount(from: string, to: string, filters: DimensionFilters): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .input("DepartmentId", sql.Int, filters.departmentId ?? null)
    .input("LocationId", sql.Int, filters.locationId ?? null)
    .input("DesignationId", sql.Int, filters.designationId ?? null)
    .input("ProcessId", sql.Int, filters.processId ?? null)
    .query<{ Cnt: number }>(`SELECT COUNT(*) AS Cnt FROM [master].Employee e WHERE e.LeftDate BETWEEN @From AND @To AND ${EMPLOYEE_DIMENSION_FILTER}`);
  return result.recordset[0]?.Cnt ?? 0;
}

/** A transfer counts toward a dimension filter if the employee's Previous OR New value on
 * that dimension matches - so a filtered view shows movement both into and out of it, not just
 * one side. */
export async function getTransfersCount(from: string, to: string, filters: DimensionFilters): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .input("DepartmentId", sql.Int, filters.departmentId ?? null)
    .input("LocationId", sql.Int, filters.locationId ?? null)
    .input("ProcessId", sql.Int, filters.processId ?? null)
    .query<{ Cnt: number }>(`
      SELECT COUNT(*) AS Cnt
      FROM [master].EmployeeTransfer t
      WHERE t.EffectiveDate BETWEEN @From AND @To
        AND (@DepartmentId IS NULL OR t.PreviousDepartmentId = @DepartmentId OR t.NewDepartmentId = @DepartmentId)
        AND (@LocationId IS NULL OR t.PreviousLocationId = @LocationId OR t.NewLocationId = @LocationId)
        AND (@ProcessId IS NULL OR t.PreviousPrimaryProcessId = @ProcessId OR t.NewPrimaryProcessId = @ProcessId)
    `);
  return result.recordset[0]?.Cnt ?? 0;
}

export interface JoinerExitRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  date: string;
  type: "JOINED" | "EXITED";
}

export async function listJoinersAndExits(from: string, to: string, filters: DimensionFilters): Promise<JoinerExitRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .input("DepartmentId", sql.Int, filters.departmentId ?? null)
    .input("LocationId", sql.Int, filters.locationId ?? null)
    .input("DesignationId", sql.Int, filters.designationId ?? null)
    .input("ProcessId", sql.Int, filters.processId ?? null)
    .query<{ EmployeeId: string; EmployeeCode: string; FullName: string; JoinDate: string | null; LeftDate: string | null }>(`
      SELECT e.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS FullName, CONVERT(VARCHAR(10), e.JoinDate, 23) AS JoinDate, CONVERT(VARCHAR(10), e.LeftDate, 23) AS LeftDate
      FROM [master].Employee e
      WHERE (e.JoinDate BETWEEN @From AND @To OR e.LeftDate BETWEEN @From AND @To) AND ${EMPLOYEE_DIMENSION_FILTER}
    `);
  const rows: JoinerExitRow[] = [];
  for (const r of result.recordset) {
    if (r.JoinDate && r.JoinDate >= from && r.JoinDate <= to) rows.push({ employeeId: r.EmployeeId, employeeCode: r.EmployeeCode, fullName: r.FullName, date: r.JoinDate, type: "JOINED" });
    if (r.LeftDate && r.LeftDate >= from && r.LeftDate <= to) rows.push({ employeeId: r.EmployeeId, employeeCode: r.EmployeeCode, fullName: r.FullName, date: r.LeftDate, type: "EXITED" });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface TransferRow {
  employeeTransferId: number;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  effectiveDate: string;
  previousDepartmentName: string | null;
  newDepartmentName: string | null;
  previousLocationName: string | null;
  newLocationName: string | null;
  previousProcessName: string | null;
  newProcessName: string | null;
}

export async function listTransfers(from: string, to: string, filters: DimensionFilters): Promise<TransferRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .input("DepartmentId", sql.Int, filters.departmentId ?? null)
    .input("LocationId", sql.Int, filters.locationId ?? null)
    .input("ProcessId", sql.Int, filters.processId ?? null)
    .query<{
      EmployeeTransferId: number;
      EmployeeId: string;
      EmployeeCode: string;
      FullName: string;
      EffectiveDate: string;
      PreviousDepartmentName: string | null;
      NewDepartmentName: string | null;
      PreviousLocationName: string | null;
      NewLocationName: string | null;
      PreviousProcessName: string | null;
      NewProcessName: string | null;
    }>(`
      SELECT
        t.EmployeeTransferId, t.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS FullName, CONVERT(VARCHAR(10), t.EffectiveDate, 23) AS EffectiveDate,
        prevDept.DepartmentName AS PreviousDepartmentName, newDept.DepartmentName AS NewDepartmentName,
        prevLoc.LocationName AS PreviousLocationName, newLoc.LocationName AS NewLocationName,
        prevProc.ProcessName AS PreviousProcessName, newProc.ProcessName AS NewProcessName
      FROM [master].EmployeeTransfer t
      JOIN [master].Employee e ON e.EmployeeId = t.EmployeeId
      LEFT JOIN [master].Department prevDept ON prevDept.DepartmentId = t.PreviousDepartmentId
      LEFT JOIN [master].Department newDept ON newDept.DepartmentId = t.NewDepartmentId
      LEFT JOIN [master].Location prevLoc ON prevLoc.LocationId = t.PreviousLocationId
      LEFT JOIN [master].Location newLoc ON newLoc.LocationId = t.NewLocationId
      LEFT JOIN [master].Process prevProc ON prevProc.ProcessId = t.PreviousPrimaryProcessId
      LEFT JOIN [master].Process newProc ON newProc.ProcessId = t.NewPrimaryProcessId
      WHERE t.EffectiveDate BETWEEN @From AND @To
        AND (@DepartmentId IS NULL OR t.PreviousDepartmentId = @DepartmentId OR t.NewDepartmentId = @DepartmentId)
        AND (@LocationId IS NULL OR t.PreviousLocationId = @LocationId OR t.NewLocationId = @LocationId)
        AND (@ProcessId IS NULL OR t.PreviousPrimaryProcessId = @ProcessId OR t.NewPrimaryProcessId = @ProcessId)
      ORDER BY t.EffectiveDate DESC
    `);
  return result.recordset.map((r) => ({
    employeeTransferId: r.EmployeeTransferId,
    employeeId: r.EmployeeId,
    employeeCode: r.EmployeeCode,
    fullName: r.FullName,
    effectiveDate: r.EffectiveDate,
    previousDepartmentName: r.PreviousDepartmentName,
    newDepartmentName: r.NewDepartmentName,
    previousLocationName: r.PreviousLocationName,
    newLocationName: r.NewLocationName,
    previousProcessName: r.PreviousProcessName,
    newProcessName: r.NewProcessName,
  }));
}

/** How many currently-active employees still have no real JoinDate at all - see
 * documentation/attrition.md's backfill note (migration 0014 backfills every employee that
 * existed before Attrition shipped from their own real CreatedAt, so this should normally read
 * 0; a non-zero count means something inserted a row without going through either the importer
 * or Admin > Employees). Surfaced as an honest caveat on the Attrition screen, not hidden. */
export async function countActiveEmployeesMissingJoinDate(): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().query<{ Cnt: number }>(`SELECT COUNT(*) AS Cnt FROM [master].Employee WHERE IsActive = 1 AND JoinDate IS NULL`);
  return result.recordset[0]?.Cnt ?? 0;
}
