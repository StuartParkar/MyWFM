import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export interface ProcessScheduleKeyRow {
  employeeId: string;
  businessDate: string;
  processId: number;
  processName: string | null;
  shiftId: number | null;
  startTime: string | null;
  endTime: string | null;
  isOvernight: boolean | null;
  isWeeklyOff: boolean;
}

/**
 * Row-level (one per scheduled employee/day), not pre-aggregated: computing real scheduled
 * minutes needs computeScheduledWindow's timezone-aware date math (attendance.service.ts),
 * which SQL can't do - the caller aggregates these into Scheduled HC/minutes per
 * (businessDate, processId) itself, same division of labor as shrinkage.repository.ts's
 * listScheduleAndShrinkageDays feeding attendance.service.ts's computeScheduledWindow.
 */
export async function listPublishedRosterKeysByProcess(params: { from: string; to: string; processId?: number }): Promise<ProcessScheduleKeyRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{
      EmployeeId: string;
      BusinessDate: string;
      ProcessId: number;
      ProcessName: string | null;
      ShiftId: number | null;
      StartTime: string | null;
      EndTime: string | null;
      IsOvernight: boolean | null;
      IsWeeklyOff: boolean;
    }>(`
      SELECT
        pr.EmployeeId, CONVERT(VARCHAR(10), pr.BusinessDate, 23) AS BusinessDate, rr.ProcessId, proc.ProcessName,
        pr.ShiftId, CONVERT(VARCHAR(5), sh.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), sh.EndTime, 108) AS EndTime,
        sh.IsOvernight, pr.IsWeeklyOff
      FROM [roster].PublishedRoster pr
      JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      JOIN [master].Process proc ON proc.ProcessId = rr.ProcessId
      LEFT JOIN [master].Shift sh ON sh.ShiftId = pr.ShiftId
      WHERE pr.IsActive = 1 AND pr.BusinessDate BETWEEN @From AND @To
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
    `);
  return result.recordset.map((r) => ({
    employeeId: r.EmployeeId,
    businessDate: r.BusinessDate,
    processId: r.ProcessId,
    processName: r.ProcessName,
    shiftId: r.ShiftId,
    startTime: r.StartTime,
    endTime: r.EndTime,
    isOvernight: r.IsOvernight,
    isWeeklyOff: r.IsWeeklyOff,
  }));
}

export interface ProcessPresentCountRow {
  businessDate: string;
  processId: number;
  presentHC: number;
}

export async function listPresentCountByProcess(params: { from: string; to: string; processId?: number }): Promise<ProcessPresentCountRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ BusinessDate: string; ProcessId: number; PresentHC: number }>(`
      SELECT CONVERT(VARCHAR(10), pr.BusinessDate, 23) AS BusinessDate, rr.ProcessId,
             COUNT(DISTINCT pr.EmployeeId) AS PresentHC
      FROM [roster].PublishedRoster pr
      JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      JOIN [attendance].AttendanceSession att ON att.EmployeeId = pr.EmployeeId AND att.BusinessDate = pr.BusinessDate
      WHERE pr.IsActive = 1 AND pr.BusinessDate BETWEEN @From AND @To
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
      GROUP BY pr.BusinessDate, rr.ProcessId
    `);
  return result.recordset.map((r) => ({ businessDate: r.BusinessDate, processId: r.ProcessId, presentHC: r.PresentHC }));
}

export interface ProcessShrinkageMinutesRow {
  businessDate: string;
  processId: number;
  shrinkageMinutes: number;
}

export async function listShrinkageMinutesByProcess(params: { from: string; to: string; processId?: number }): Promise<ProcessShrinkageMinutesRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ BusinessDate: string; ProcessId: number; ShrinkageMinutes: number }>(`
      SELECT CONVERT(VARCHAR(10), pr.BusinessDate, 23) AS BusinessDate, rr.ProcessId,
             SUM(se.Minutes) AS ShrinkageMinutes
      FROM [shrinkage].ShrinkageEntry se
      JOIN [roster].PublishedRoster pr ON pr.EmployeeId = se.EmployeeId AND pr.BusinessDate = se.BusinessDate AND pr.IsActive = 1
      JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      WHERE se.BusinessDate BETWEEN @From AND @To
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
      GROUP BY pr.BusinessDate, rr.ProcessId
    `);
  return result.recordset.map((r) => ({ businessDate: r.BusinessDate, processId: r.ProcessId, shrinkageMinutes: r.ShrinkageMinutes }));
}

export interface RequirementCoverageRow {
  rosterRequirementId: number;
  businessDate: string;
  departmentId: number | null;
  departmentName: string | null;
  processId: number | null;
  processName: string | null;
  shiftId: number | null;
  shiftCode: string | null;
  requiredHc: number;
  scheduledHc: number;
  presentHc: number;
}

/**
 * Scheduled HC and Present HC are counted from roster.PublishedRoster rows already linked to
 * this requirement (RosterRequirementId, set when Phase 4's publishRequirement() ran) rather
 * than re-deriving "which employees belong to this department/process/shift" independently -
 * that link is exactly what the roster workflow already established, so re-deriving it here
 * would risk quietly disagreeing with what was actually published.
 */
export async function listPublishedRequirementCoverage(params: {
  from: string;
  to: string;
  departmentId?: number;
  processId?: number;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<RequirementCoverageRow>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("DepartmentId", sql.Int, params.departmentId ?? null)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize)
    .query<{
      RosterRequirementId: number;
      BusinessDate: string;
      DepartmentId: number | null;
      DepartmentName: string | null;
      ProcessId: number | null;
      ProcessName: string | null;
      ShiftId: number | null;
      ShiftCode: string | null;
      RequiredHC: number;
      ScheduledHC: number;
      PresentHC: number;
      TotalCount: number;
    }>(`
      SELECT
        rr.RosterRequirementId, CONVERT(VARCHAR(10), rr.BusinessDate, 23) AS BusinessDate,
        rr.DepartmentId, dept.DepartmentName, rr.ProcessId, proc.ProcessName, rr.ShiftId, sh.ShiftCode,
        rr.RequiredHC,
        COUNT(DISTINCT pr.PublishedRosterId) AS ScheduledHC,
        COUNT(DISTINCT CASE WHEN att.AttendanceSessionId IS NOT NULL THEN pr.EmployeeId END) AS PresentHC,
        COUNT(*) OVER() AS TotalCount
      FROM [roster].RosterRequirement rr
      LEFT JOIN [master].Department dept ON dept.DepartmentId = rr.DepartmentId
      LEFT JOIN [master].Process proc ON proc.ProcessId = rr.ProcessId
      LEFT JOIN [master].Shift sh ON sh.ShiftId = rr.ShiftId
      LEFT JOIN [roster].PublishedRoster pr ON pr.RosterRequirementId = rr.RosterRequirementId AND pr.IsActive = 1
      LEFT JOIN [attendance].AttendanceSession att ON att.EmployeeId = pr.EmployeeId AND att.BusinessDate = pr.BusinessDate
      WHERE rr.Status = 'PUBLISHED' AND rr.BusinessDate BETWEEN @From AND @To
        AND (@DepartmentId IS NULL OR rr.DepartmentId = @DepartmentId)
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
      GROUP BY rr.RosterRequirementId, rr.BusinessDate, rr.DepartmentId, dept.DepartmentName, rr.ProcessId, proc.ProcessName, rr.ShiftId, sh.ShiftCode, rr.RequiredHC
      ORDER BY rr.BusinessDate DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      rosterRequirementId: r.RosterRequirementId,
      businessDate: r.BusinessDate,
      departmentId: r.DepartmentId,
      departmentName: r.DepartmentName,
      processId: r.ProcessId,
      processName: r.ProcessName,
      shiftId: r.ShiftId,
      shiftCode: r.ShiftCode,
      requiredHc: r.RequiredHC,
      scheduledHc: r.ScheduledHC,
      presentHc: r.PresentHC,
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}
