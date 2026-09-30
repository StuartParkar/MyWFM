import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";
import type { ScheduleKeyRow } from "../attendance/attendance.repository.js";

export type ShrinkageSource = "MANUAL" | "IMPORT" | "ADJUSTMENT";

/**
 * The same "union of scheduled days and activity days" shape as
 * attendance.repository.ts's listScheduleAndSessionDays, reusing its ScheduleKeyRow type so
 * shrinkage.service.ts can feed it straight into attendance.service.ts's
 * computeScheduledWindow - but querying ShrinkageEntry as the activity side instead of
 * AttendanceSession, so this is its own query rather than a shared one.
 */
export async function listScheduleAndShrinkageDays(params: {
  employeeId?: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<ScheduleKeyRow>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, params.employeeId ?? null)
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize)
    .query<{
      EmployeeId: string;
      EmployeeCode: string;
      EmployeeName: string;
      BusinessDate: string;
      ShiftId: number | null;
      ShiftCode: string | null;
      StartTime: string | null;
      EndTime: string | null;
      IsOvernight: boolean | null;
      IsWeeklyOff: boolean;
      TotalCount: number;
    }>(`
      WITH ScheduledDays AS (
        SELECT pr.EmployeeId, pr.BusinessDate, pr.ShiftId, pr.IsWeeklyOff
        FROM [roster].PublishedRoster pr
        WHERE pr.IsActive = 1 AND pr.BusinessDate BETWEEN @From AND @To
          AND (@EmployeeId IS NULL OR pr.EmployeeId = @EmployeeId)
      ),
      ShrinkageDays AS (
        SELECT DISTINCT s.EmployeeId, s.BusinessDate
        FROM [shrinkage].ShrinkageEntry s
        WHERE s.BusinessDate BETWEEN @From AND @To
          AND (@EmployeeId IS NULL OR s.EmployeeId = @EmployeeId)
      ),
      Keys AS (
        SELECT EmployeeId, BusinessDate FROM ScheduledDays
        UNION
        SELECT EmployeeId, BusinessDate FROM ShrinkageDays
      )
      SELECT
        k.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS EmployeeName, CONVERT(VARCHAR(10), k.BusinessDate, 23) AS BusinessDate,
        sd.ShiftId, sh.ShiftCode,
        CONVERT(VARCHAR(5), sh.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), sh.EndTime, 108) AS EndTime, sh.IsOvernight,
        ISNULL(sd.IsWeeklyOff, CAST(0 AS BIT)) AS IsWeeklyOff,
        COUNT(*) OVER() AS TotalCount
      FROM Keys k
      JOIN [master].Employee e ON e.EmployeeId = k.EmployeeId
      LEFT JOIN ScheduledDays sd ON sd.EmployeeId = k.EmployeeId AND sd.BusinessDate = k.BusinessDate
      LEFT JOIN [master].Shift sh ON sh.ShiftId = sd.ShiftId
      ORDER BY k.BusinessDate DESC, COALESCE(e.AliasName, e.FullName)
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      employeeId: r.EmployeeId,
      employeeCode: r.EmployeeCode,
      employeeName: r.EmployeeName,
      businessDate: r.BusinessDate,
      shiftId: r.ShiftId,
      shiftCode: r.ShiftCode,
      startTime: r.StartTime,
      endTime: r.EndTime,
      isOvernight: r.IsOvernight,
      isWeeklyOff: r.IsWeeklyOff,
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}

export interface ShrinkageCategoryRow {
  shrinkageCategoryId: number;
  categoryCode: string;
  categoryName: string;
}

export async function listCategories(): Promise<ShrinkageCategoryRow[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ ShrinkageCategoryId: number; CategoryCode: string; CategoryName: string }>(`
    SELECT ShrinkageCategoryId, CategoryCode, CategoryName FROM [shrinkage].ShrinkageCategory WHERE IsActive = 1 ORDER BY CategoryName
  `);
  return result.recordset.map((r) => ({ shrinkageCategoryId: r.ShrinkageCategoryId, categoryCode: r.CategoryCode, categoryName: r.CategoryName }));
}

export interface CreateEntryInput {
  employeeId: string;
  businessDate: string;
  shrinkageCategoryId: number;
  minutes: number;
  notes?: string | null;
  source?: ShrinkageSource;
  recordedByUserId: string;
}

export async function createEntry(input: CreateEntryInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, input.employeeId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("ShrinkageCategoryId", sql.Int, input.shrinkageCategoryId)
    .input("Minutes", sql.Int, input.minutes)
    .input("Notes", sql.NVarChar(500), input.notes ?? null)
    .input("Source", sql.VarChar(20), input.source ?? "MANUAL")
    .input("RecordedByUserId", sql.UniqueIdentifier, input.recordedByUserId)
    .query<{ ShrinkageEntryId: number }>(`
      INSERT INTO [shrinkage].ShrinkageEntry (EmployeeId, BusinessDate, ShrinkageCategoryId, Minutes, Notes, Source, RecordedByUserId)
      OUTPUT INSERTED.ShrinkageEntryId
      VALUES (@EmployeeId, @BusinessDate, @ShrinkageCategoryId, @Minutes, @Notes, @Source, @RecordedByUserId)
    `);
  return result.recordset[0]!.ShrinkageEntryId;
}

export interface ShrinkageEntryRow {
  shrinkageEntryId: number;
  employeeId: string;
  businessDate: string;
  shrinkageCategoryId: number;
  categoryCode: string;
  categoryName: string;
  minutes: number;
  notes: string | null;
  source: ShrinkageSource;
}

export async function getEntry(id: number): Promise<ShrinkageEntryRow | null> {
  const pool = await getPool();
  const result = await pool.request().input("Id", sql.BigInt, id).query<{
    ShrinkageEntryId: number;
    EmployeeId: string;
    BusinessDate: string;
    ShrinkageCategoryId: number;
    CategoryCode: string;
    CategoryName: string;
    Minutes: number;
    Notes: string | null;
    Source: string;
  }>(`
    SELECT e.ShrinkageEntryId, e.EmployeeId, CONVERT(VARCHAR(10), e.BusinessDate, 23) AS BusinessDate,
           e.ShrinkageCategoryId, c.CategoryCode, c.CategoryName, e.Minutes, e.Notes, e.Source
    FROM [shrinkage].ShrinkageEntry e
    JOIN [shrinkage].ShrinkageCategory c ON c.ShrinkageCategoryId = e.ShrinkageCategoryId
    WHERE e.ShrinkageEntryId = @Id
  `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    shrinkageEntryId: row.ShrinkageEntryId,
    employeeId: row.EmployeeId,
    businessDate: row.BusinessDate,
    shrinkageCategoryId: row.ShrinkageCategoryId,
    categoryCode: row.CategoryCode,
    categoryName: row.CategoryName,
    minutes: row.Minutes,
    notes: row.Notes,
    source: row.Source as ShrinkageSource,
  };
}

export async function updateEntry(id: number, patch: { minutes?: number; shrinkageCategoryId?: number; notes?: string | null }): Promise<void> {
  const pool = await getPool();
  const request = pool.request().input("Id", sql.BigInt, id);
  const sets: string[] = [];
  if (patch.minutes !== undefined) {
    request.input("Minutes", sql.Int, patch.minutes);
    sets.push("Minutes = @Minutes");
  }
  if (patch.shrinkageCategoryId !== undefined) {
    request.input("ShrinkageCategoryId", sql.Int, patch.shrinkageCategoryId);
    sets.push("ShrinkageCategoryId = @ShrinkageCategoryId");
  }
  if (patch.notes !== undefined) {
    request.input("Notes", sql.NVarChar(500), patch.notes);
    sets.push("Notes = @Notes");
  }
  if (sets.length === 0) return;
  sets.push("ModifiedAt = SYSUTCDATETIME()");
  await request.query(`UPDATE [shrinkage].ShrinkageEntry SET ${sets.join(", ")} WHERE ShrinkageEntryId = @Id`);
}

export async function deleteEntry(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("Id", sql.BigInt, id).query(`DELETE FROM [shrinkage].ShrinkageEntry WHERE ShrinkageEntryId = @Id`);
}

export async function listEntriesForRange(employeeId: string | undefined, from: string, to: string): Promise<ShrinkageEntryRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId ?? null)
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .query<{
      ShrinkageEntryId: number;
      EmployeeId: string;
      BusinessDate: string;
      ShrinkageCategoryId: number;
      CategoryCode: string;
      CategoryName: string;
      Minutes: number;
      Notes: string | null;
      Source: string;
    }>(`
      SELECT e.ShrinkageEntryId, e.EmployeeId, CONVERT(VARCHAR(10), e.BusinessDate, 23) AS BusinessDate,
             e.ShrinkageCategoryId, c.CategoryCode, c.CategoryName, e.Minutes, e.Notes, e.Source
      FROM [shrinkage].ShrinkageEntry e
      JOIN [shrinkage].ShrinkageCategory c ON c.ShrinkageCategoryId = e.ShrinkageCategoryId
      WHERE e.BusinessDate BETWEEN @From AND @To
        AND (@EmployeeId IS NULL OR e.EmployeeId = @EmployeeId)
      ORDER BY e.EmployeeId, e.BusinessDate
    `);
  return result.recordset.map((row) => ({
    shrinkageEntryId: row.ShrinkageEntryId,
    employeeId: row.EmployeeId,
    businessDate: row.BusinessDate,
    shrinkageCategoryId: row.ShrinkageCategoryId,
    categoryCode: row.CategoryCode,
    categoryName: row.CategoryName,
    minutes: row.Minutes,
    notes: row.Notes,
    source: row.Source as ShrinkageSource,
  }));
}
