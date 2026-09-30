import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export type SessionSource = "MANUAL" | "IMPORT" | "ADJUSTMENT";

export interface CreateSessionInput {
  employeeId: string;
  businessDate: string;
  sessionStart: string;
  sessionEnd?: string | null;
  breakMinutes?: number;
  source?: SessionSource;
  recordedByUserId: string;
}

export async function createSession(input: CreateSessionInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, input.employeeId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("SessionStart", sql.DateTime2, new Date(input.sessionStart))
    .input("SessionEnd", sql.DateTime2, input.sessionEnd ? new Date(input.sessionEnd) : null)
    .input("BreakMinutes", sql.Int, input.breakMinutes ?? 0)
    .input("Source", sql.VarChar(20), input.source ?? "MANUAL")
    .input("RecordedByUserId", sql.UniqueIdentifier, input.recordedByUserId)
    .query<{ AttendanceSessionId: number }>(`
      INSERT INTO [attendance].AttendanceSession (EmployeeId, BusinessDate, SessionStart, SessionEnd, BreakMinutes, Source, RecordedByUserId)
      OUTPUT INSERTED.AttendanceSessionId
      VALUES (@EmployeeId, @BusinessDate, @SessionStart, @SessionEnd, @BreakMinutes, @Source, @RecordedByUserId)
    `);
  return result.recordset[0]!.AttendanceSessionId;
}

export interface AttendanceSessionRow {
  attendanceSessionId: number;
  employeeId: string;
  businessDate: string;
  sessionStart: string;
  sessionEnd: string | null;
  breakMinutes: number;
  source: SessionSource;
}

function mapSessionRow(row: {
  AttendanceSessionId: number;
  EmployeeId: string;
  BusinessDate: string;
  SessionStart: Date;
  SessionEnd: Date | null;
  BreakMinutes: number;
  Source: string;
}): AttendanceSessionRow {
  return {
    attendanceSessionId: row.AttendanceSessionId,
    employeeId: row.EmployeeId,
    businessDate: row.BusinessDate,
    sessionStart: row.SessionStart.toISOString(),
    sessionEnd: row.SessionEnd ? row.SessionEnd.toISOString() : null,
    breakMinutes: row.BreakMinutes,
    source: row.Source as SessionSource,
  };
}

export async function getSession(id: number): Promise<AttendanceSessionRow | null> {
  const pool = await getPool();
  const result = await pool.request().input("Id", sql.BigInt, id).query<{
    AttendanceSessionId: number;
    EmployeeId: string;
    BusinessDate: string;
    SessionStart: Date;
    SessionEnd: Date | null;
    BreakMinutes: number;
    Source: string;
  }>(`
    SELECT AttendanceSessionId, EmployeeId, CONVERT(VARCHAR(10), BusinessDate, 23) AS BusinessDate, SessionStart, SessionEnd, BreakMinutes, Source
    FROM [attendance].AttendanceSession WHERE AttendanceSessionId = @Id
  `);
  const row = result.recordset[0];
  return row ? mapSessionRow(row) : null;
}

export interface UpdateSessionInput {
  sessionStart?: string;
  sessionEnd?: string | null;
  breakMinutes?: number;
}

export async function updateSession(id: number, patch: UpdateSessionInput): Promise<void> {
  const pool = await getPool();
  const request = pool.request().input("Id", sql.BigInt, id);
  const sets: string[] = [];
  if (patch.sessionStart !== undefined) {
    request.input("SessionStart", sql.DateTime2, new Date(patch.sessionStart));
    sets.push("SessionStart = @SessionStart");
  }
  if (patch.sessionEnd !== undefined) {
    request.input("SessionEnd", sql.DateTime2, patch.sessionEnd ? new Date(patch.sessionEnd) : null);
    sets.push("SessionEnd = @SessionEnd");
  }
  if (patch.breakMinutes !== undefined) {
    request.input("BreakMinutes", sql.Int, patch.breakMinutes);
    sets.push("BreakMinutes = @BreakMinutes");
  }
  if (sets.length === 0) return;
  sets.push("ModifiedAt = SYSUTCDATETIME()");
  await request.query(`UPDATE [attendance].AttendanceSession SET ${sets.join(", ")} WHERE AttendanceSessionId = @Id`);
}

export async function deleteSession(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("Id", sql.BigInt, id).query(`DELETE FROM [attendance].AttendanceSession WHERE AttendanceSessionId = @Id`);
}

/**
 * Sessions for an exact set of (employeeId, businessDate) pairs - used by
 * listDailySummaries (attendance.service.ts) to fetch only the current page's
 * keys, instead of listSessionsForRange's full from/to span discarded down to
 * one page in memory. Callers own keeping the list to a bounded size (it's
 * always exactly one already-paginated page in practice).
 */
export async function listSessionsForKeys(
  keys: { employeeId: string; businessDate: string }[],
): Promise<AttendanceSessionRow[]> {
  if (keys.length === 0) return [];

  const pool = await getPool();
  const request = pool.request();
  const valueRows = keys.map((key, i) => {
    request.input(`EmployeeId${i}`, sql.UniqueIdentifier, key.employeeId);
    request.input(`BusinessDate${i}`, sql.Date, key.businessDate);
    return `(@EmployeeId${i}, @BusinessDate${i})`;
  });

  const result = await request.query<{
    AttendanceSessionId: number;
    EmployeeId: string;
    BusinessDate: string;
    SessionStart: Date;
    SessionEnd: Date | null;
    BreakMinutes: number;
    Source: string;
  }>(`
    SELECT s.AttendanceSessionId, s.EmployeeId, CONVERT(VARCHAR(10), s.BusinessDate, 23) AS BusinessDate,
           s.SessionStart, s.SessionEnd, s.BreakMinutes, s.Source
    FROM [attendance].AttendanceSession s
    JOIN (VALUES ${valueRows.join(", ")}) AS k(EmployeeId, BusinessDate)
      ON s.EmployeeId = k.EmployeeId AND s.BusinessDate = k.BusinessDate
    ORDER BY s.EmployeeId, s.BusinessDate, s.SessionStart
  `);
  return result.recordset.map(mapSessionRow);
}

export async function listSessionsForRange(employeeId: string | undefined, from: string, to: string): Promise<AttendanceSessionRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId ?? null)
    .input("From", sql.Date, from)
    .input("To", sql.Date, to)
    .query<{
      AttendanceSessionId: number;
      EmployeeId: string;
      BusinessDate: string;
      SessionStart: Date;
      SessionEnd: Date | null;
      BreakMinutes: number;
      Source: string;
    }>(`
      SELECT AttendanceSessionId, EmployeeId, CONVERT(VARCHAR(10), BusinessDate, 23) AS BusinessDate, SessionStart, SessionEnd, BreakMinutes, Source
      FROM [attendance].AttendanceSession
      WHERE BusinessDate BETWEEN @From AND @To
        AND (@EmployeeId IS NULL OR EmployeeId = @EmployeeId)
      ORDER BY EmployeeId, BusinessDate, SessionStart
    `);
  return result.recordset.map(mapSessionRow);
}

export interface ScheduleKeyRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  shiftId: number | null;
  shiftCode: string | null;
  startTime: string | null;
  endTime: string | null;
  isOvernight: boolean | null;
  isWeeklyOff: boolean;
}

/**
 * One row per (employee, business date) that either has an active published-roster
 * assignment or at least one recorded attendance session in range - the union of the two
 * keysets, so a scheduled-but-absent day shows up (with no sessions) just as much as an
 * attendance day with no matching schedule does.
 */
export async function listScheduleAndSessionDays(params: {
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
      SessionDays AS (
        SELECT DISTINCT s.EmployeeId, s.BusinessDate
        FROM [attendance].AttendanceSession s
        WHERE s.BusinessDate BETWEEN @From AND @To
          AND (@EmployeeId IS NULL OR s.EmployeeId = @EmployeeId)
      ),
      Keys AS (
        SELECT EmployeeId, BusinessDate FROM ScheduledDays
        UNION
        SELECT EmployeeId, BusinessDate FROM SessionDays
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
