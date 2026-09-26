import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

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
