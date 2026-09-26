import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export interface EmployeeListItem {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  aliasName: string | null;
  locationName: string | null;
  departmentName: string | null;
  designationName: string | null;
  teamLeaderName: string | null;
  unitHodName: string | null;
  isActive: boolean;
  joinDate: string | null;
  leftDate: string | null;
}

export interface ListEmployeesParams {
  page: number;
  pageSize: number;
  search?: string;
  departmentId?: number;
  locationId?: number;
}

/**
 * List views are server-side paginated (build spec section 47 - never
 * render thousands of rows in one browser-rendered table).
 */
export async function listEmployees(params: ListEmployeesParams): Promise<PaginatedResult<EmployeeListItem>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;

  const request = pool
    .request()
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize);
  if (params.search) request.input("Search", sql.NVarChar(200), `%${params.search}%`);
  if (params.departmentId) request.input("DepartmentId", sql.Int, params.departmentId);
  if (params.locationId) request.input("LocationId", sql.Int, params.locationId);

  const whereClauses = ["1 = 1"];
  if (params.search) whereClauses.push("(e.FullName LIKE @Search OR e.EmployeeCode LIKE @Search OR e.AliasName LIKE @Search)");
  if (params.departmentId) whereClauses.push("e.DepartmentId = @DepartmentId");
  if (params.locationId) whereClauses.push("e.LocationId = @LocationId");
  const where = whereClauses.join(" AND ");

  const dataResult = await request.query<EmployeeListItem & { TotalCount: number }>(`
    SELECT
      e.EmployeeId       AS employeeId,
      e.EmployeeCode     AS employeeCode,
      e.FullName         AS fullName,
      e.AliasName        AS aliasName,
      loc.LocationName   AS locationName,
      dept.DepartmentName AS departmentName,
      des.DesignationName AS designationName,
      tl.FullName        AS teamLeaderName,
      hod.FullName       AS unitHodName,
      e.IsActive         AS isActive,
      CONVERT(VARCHAR(10), e.JoinDate, 23) AS joinDate,
      CONVERT(VARCHAR(10), e.LeftDate, 23) AS leftDate,
      COUNT(*) OVER()    AS TotalCount
    FROM [master].Employee e
    LEFT JOIN [master].Location loc ON loc.LocationId = e.LocationId
    LEFT JOIN [master].Department dept ON dept.DepartmentId = e.DepartmentId
    LEFT JOIN [master].Designation des ON des.DesignationId = e.DesignationId
    LEFT JOIN [master].Employee tl ON tl.EmployeeId = e.TeamLeaderEmployeeId
    LEFT JOIN [master].Employee hod ON hod.EmployeeId = e.UnitHodEmployeeId
    WHERE ${where}
    ORDER BY e.FullName
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  const totalItems = dataResult.recordset[0]?.TotalCount ?? 0;
  return {
    items: dataResult.recordset.map(({ TotalCount: _TotalCount, ...row }) => row),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}

interface CodeNameRow {
  id: number;
  code: string;
  name: string;
}

async function listCodeNameLookup(table: string, idCol: string, codeCol: string, nameCol: string): Promise<CodeNameRow[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ id: number; code: string; name: string }>(`
    SELECT ${idCol} AS id, ${codeCol} AS code, ${nameCol} AS name
    FROM [master].${table}
    WHERE IsActive = 1
    ORDER BY ${nameCol}
  `);
  return result.recordset;
}

export const listLocations = () => listCodeNameLookup("Location", "LocationId", "LocationCode", "LocationName");
export const listProcesses = () => listCodeNameLookup("Process", "ProcessId", "ProcessCode", "ProcessName");
export const listSkills = () => listCodeNameLookup("Skill", "SkillId", "SkillCode", "SkillName");

export interface QueueLookupRow extends CodeNameRow {
  processId: number | null;
  processName: string | null;
}

/**
 * Queue needs its own query rather than listCodeNameLookup: ProcessId is how Calls workload
 * (build spec section 19's workload-derived Staffing) attributes to a roster requirement's
 * process, so every consumer needs to see it, not just Admin > Queues.
 */
export async function listQueues(): Promise<QueueLookupRow[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ id: number; code: string; name: string; processId: number | null; processName: string | null }>(`
    SELECT q.QueueId AS id, q.QueueCode AS code, q.QueueName AS name, q.ProcessId AS processId, p.ProcessName AS processName
    FROM [master].Queue q
    LEFT JOIN [master].Process p ON p.ProcessId = q.ProcessId
    WHERE q.IsActive = 1
    ORDER BY q.QueueName
  `);
  return result.recordset;
}

export async function setQueueProcess(queueId: number, processId: number | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("QueueId", sql.Int, queueId)
    .input("ProcessId", sql.Int, processId)
    .query(`UPDATE [master].Queue SET ProcessId = @ProcessId WHERE QueueId = @QueueId`);
}

export async function listDepartments(): Promise<{ id: number; name: string }[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ id: number; name: string }>(`
    SELECT DepartmentId AS id, DepartmentName AS name FROM [master].Department WHERE IsActive = 1 ORDER BY DepartmentName
  `);
  return result.recordset;
}

export async function listDesignations(): Promise<{ id: number; code: string; name: string; level: number }[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ id: number; code: string; name: string; level: number }>(`
    SELECT DesignationId AS id, DesignationCode AS code, DesignationName AS name, HierarchyLevel AS level
    FROM [master].Designation ORDER BY HierarchyLevel
  `);
  return result.recordset;
}

export async function listShifts(): Promise<{ id: number; code: string; startTime: string; endTime: string; isOvernight: boolean }[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ id: number; code: string; startTime: string; endTime: string; isOvernight: boolean }>(`
    SELECT ShiftId AS id, ShiftCode AS code, CONVERT(VARCHAR(5), StartTime, 108) AS startTime,
           CONVERT(VARCHAR(5), EndTime, 108) AS endTime, IsOvernight AS isOvernight
    FROM [master].Shift WHERE IsActive = 1 ORDER BY ShiftCode
  `);
  return result.recordset;
}

export interface OrgLookupItem {
  employeeId: string;
  fullName: string;
  aliasName: string | null;
}

export async function listUnitHods(): Promise<OrgLookupItem[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ EmployeeId: string; FullName: string; AliasName: string | null }>(`
    SELECT DISTINCT e.EmployeeId, e.FullName, e.AliasName
    FROM [master].Employee e
    JOIN [master].Designation d ON d.DesignationId = e.DesignationId
    WHERE d.DesignationCode = 'UNIT_HOD' AND e.IsActive = 1
    ORDER BY e.FullName
  `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, fullName: r.FullName, aliasName: r.AliasName }));
}

export async function listTeamLeadersUnderHod(hodId: string): Promise<OrgLookupItem[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("HodId", sql.UniqueIdentifier, hodId)
    .query<{ EmployeeId: string; FullName: string; AliasName: string | null }>(`
      SELECT DISTINCT e.EmployeeId, e.FullName, e.AliasName
      FROM [master].Employee e
      JOIN [master].Designation d ON d.DesignationId = e.DesignationId
      WHERE d.DesignationCode = 'TEAM_LEADER' AND e.UnitHodEmployeeId = @HodId AND e.IsActive = 1
      ORDER BY e.FullName
    `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, fullName: r.FullName, aliasName: r.AliasName }));
}

export async function listAgentsUnderTeamLeader(tlId: string): Promise<OrgLookupItem[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("TlId", sql.UniqueIdentifier, tlId)
    .query<{ EmployeeId: string; FullName: string; AliasName: string | null }>(`
      SELECT DISTINCT e.EmployeeId, e.FullName, e.AliasName
      FROM [master].Employee e
      WHERE e.TeamLeaderEmployeeId = @TlId AND e.IsActive = 1
      ORDER BY e.FullName
    `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, fullName: r.FullName, aliasName: r.AliasName }));
}

// ---------------------------------------------------------------------------
// Writes (masterdata.manage). Table/column names below are always literals
// from this file, never request input, so string-building the SQL around
// them is safe - only bound parameter *values* ever come from the caller.
// ---------------------------------------------------------------------------

export interface CreateEmployeeInput {
  employeeCode: string;
  fullName: string;
  aliasName?: string | null;
  locationId?: number | null;
  departmentId?: number | null;
  designationId?: number | null;
  joinDate?: string | null;
}

export async function createEmployee(input: CreateEmployeeInput): Promise<string> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeCode", sql.VarChar(20), input.employeeCode)
    .input("FullName", sql.NVarChar(200), input.fullName)
    .input("AliasName", sql.NVarChar(100), input.aliasName ?? null)
    .input("LocationId", sql.Int, input.locationId ?? null)
    .input("DepartmentId", sql.Int, input.departmentId ?? null)
    .input("DesignationId", sql.Int, input.designationId ?? null)
    .input("JoinDate", sql.Date, input.joinDate ?? null)
    .query<{ EmployeeId: string }>(`
      INSERT INTO [master].Employee (EmployeeCode, FullName, AliasName, LocationId, DepartmentId, DesignationId, JoinDate)
      OUTPUT INSERTED.EmployeeId
      VALUES (@EmployeeCode, @FullName, @AliasName, @LocationId, @DepartmentId, @DesignationId, @JoinDate)
    `);
  return result.recordset[0]!.EmployeeId;
}

export interface UpdateEmployeeInput {
  fullName?: string;
  aliasName?: string | null;
  locationId?: number | null;
  departmentId?: number | null;
  designationId?: number | null;
  teamLeaderEmployeeId?: string | null;
  unitHodEmployeeId?: string | null;
  joinDate?: string | null;
  leftDate?: string | null;
  isActive?: boolean;
}

export async function getEmployeeSnapshot(employeeId: string): Promise<Record<string, unknown> | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .query(`SELECT * FROM [master].Employee WHERE EmployeeId = @EmployeeId`);
  return result.recordset[0] ?? null;
}

export async function updateEmployee(employeeId: string, input: UpdateEmployeeInput): Promise<void> {
  const pool = await getPool();
  const sets: string[] = ["ModifiedAt = SYSUTCDATETIME()"];
  const request = pool.request().input("EmployeeId", sql.UniqueIdentifier, employeeId);

  const fieldMap: Record<string, { column: string; type: ReturnType<typeof sql.NVarChar> | typeof sql.Int | typeof sql.UniqueIdentifier | typeof sql.Date | typeof sql.Bit }> = {
    fullName: { column: "FullName", type: sql.NVarChar(200) },
    aliasName: { column: "AliasName", type: sql.NVarChar(100) },
    locationId: { column: "LocationId", type: sql.Int },
    departmentId: { column: "DepartmentId", type: sql.Int },
    designationId: { column: "DesignationId", type: sql.Int },
    teamLeaderEmployeeId: { column: "TeamLeaderEmployeeId", type: sql.UniqueIdentifier },
    unitHodEmployeeId: { column: "UnitHodEmployeeId", type: sql.UniqueIdentifier },
    joinDate: { column: "JoinDate", type: sql.Date },
    leftDate: { column: "LeftDate", type: sql.Date },
    isActive: { column: "IsActive", type: sql.Bit },
  };

  for (const [key, { column, type }] of Object.entries(fieldMap)) {
    if (key in input) {
      const value = (input as Record<string, unknown>)[key];
      request.input(column, type, value ?? null);
      sets.push(`${column} = @${column}`);
    }
  }

  if (sets.length === 1) return; // nothing to update
  await request.query(`UPDATE [master].Employee SET ${sets.join(", ")} WHERE EmployeeId = @EmployeeId`);
}

async function createLookupWithCode(table: string, codeCol: string, nameCol: string, code: string, name: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Code", sql.NVarChar(100), code)
    .input("Name", sql.NVarChar(200), name)
    .query<{ id: number }>(`
      INSERT INTO [master].${table} (${codeCol}, ${nameCol}) OUTPUT INSERTED.${table}Id AS id VALUES (@Code, @Name)
    `);
  return result.recordset[0]!.id;
}

function deactivateLookup(table: string): (id: number) => Promise<void> {
  return async (id: number) => {
    const pool = await getPool();
    await pool.request().input("Id", sql.Int, id).query(`UPDATE [master].${table} SET IsActive = 0 WHERE ${table}Id = @Id`);
  };
}

export const createLocation = (code: string, name: string) => createLookupWithCode("Location", "LocationCode", "LocationName", code, name);
export const createProcess = (code: string, name: string) => createLookupWithCode("Process", "ProcessCode", "ProcessName", code, name);
export const createQueue = (code: string, name: string) => createLookupWithCode("Queue", "QueueCode", "QueueName", code, name);
export const createSkill = (code: string, name: string) => createLookupWithCode("Skill", "SkillCode", "SkillName", code, name);
export const deactivateLocation = deactivateLookup("Location");
export const deactivateProcess = deactivateLookup("Process");
export const deactivateQueue = deactivateLookup("Queue");
export const deactivateSkill = deactivateLookup("Skill");

export async function createDepartment(name: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query<{ id: number }>(`INSERT INTO [master].Department (DepartmentName) OUTPUT INSERTED.DepartmentId AS id VALUES (@Name)`);
  return result.recordset[0]!.id;
}

export const deactivateDepartment = deactivateLookup("Department");

export interface CreateShiftInput {
  shiftCode: string;
  startTime: string; // "HH:MM"
  endTime: string;
  description?: string | null;
}

export async function createShift(input: CreateShiftInput): Promise<number> {
  const isOvernight = input.endTime <= input.startTime;
  const pool = await getPool();
  const result = await pool
    .request()
    .input("ShiftCode", sql.VarChar(20), input.shiftCode)
    .input("StartTime", sql.VarChar(5), input.startTime)
    .input("EndTime", sql.VarChar(5), input.endTime)
    .input("IsOvernight", sql.Bit, isOvernight)
    .input("Description", sql.NVarChar(200), input.description ?? null)
    .query<{ id: number }>(`
      INSERT INTO [master].Shift (ShiftCode, StartTime, EndTime, IsOvernight, Description)
      OUTPUT INSERTED.ShiftId AS id
      VALUES (@ShiftCode, @StartTime, @EndTime, @IsOvernight, @Description)
    `);
  return result.recordset[0]!.id;
}

export const deactivateShift = deactivateLookup("Shift");

export interface HolidayRow {
  id: number;
  holidayDate: string;
  holidayName: string;
  locationId: number | null;
  locationName: string | null;
}

export async function listHolidays(): Promise<HolidayRow[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ id: number; holidayDate: string; holidayName: string; locationId: number | null; locationName: string | null }>(`
    SELECT h.HolidayId AS id, CONVERT(VARCHAR(10), h.HolidayDate, 23) AS holidayDate, h.HolidayName AS holidayName,
           h.LocationId AS locationId, l.LocationName AS locationName
    FROM [master].Holiday h
    LEFT JOIN [master].Location l ON l.LocationId = h.LocationId
    WHERE h.IsActive = 1
    ORDER BY h.HolidayDate
  `);
  return result.recordset;
}

export async function createHoliday(input: { holidayDate: string; holidayName: string; locationId?: number | null }): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("HolidayDate", sql.Date, input.holidayDate)
    .input("HolidayName", sql.NVarChar(150), input.holidayName)
    .input("LocationId", sql.Int, input.locationId ?? null)
    .query<{ id: number }>(`
      INSERT INTO [master].Holiday (HolidayDate, HolidayName, LocationId) OUTPUT INSERTED.HolidayId AS id
      VALUES (@HolidayDate, @HolidayName, @LocationId)
    `);
  return result.recordset[0]!.id;
}

export const deactivateHoliday = deactivateLookup("Holiday");
