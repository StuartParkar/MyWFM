import { getPool, sql } from "../../db/pool.js";

export interface ControlTowerFilters {
  from: string;
  to: string;
  processId?: number;
  hodId?: string;
  tlId?: string;
  agentSeniorId?: string;
  designationCode?: string;
}

/**
 * Company-wide, Process+Date-filtered only (build spec section 8's HOD/TL/Agent/Designation
 * cascade does not apply here): a roster requirement and a call queue are not "for" one
 * employee, so filtering either by employee hierarchy has no well-defined meaning - see
 * documentation/controltower.md. Two-level aggregation (CTE groups per requirement first,
 * then sums) so a requirement with N published assignments doesn't count its own RequiredHC
 * N times.
 */
export async function getRosterAggregate(params: { from: string; to: string; processId?: number }): Promise<{ requiredHC: number; scheduledHC: number }> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ RequiredHC: number | null; ScheduledHC: number | null }>(`
      WITH PerRequirement AS (
        SELECT rr.RosterRequirementId, rr.RequiredHC, COUNT(DISTINCT pr.PublishedRosterId) AS ScheduledHC
        FROM [roster].RosterRequirement rr
        LEFT JOIN [roster].PublishedRoster pr ON pr.RosterRequirementId = rr.RosterRequirementId AND pr.IsActive = 1
        WHERE rr.Status = 'PUBLISHED' AND rr.BusinessDate BETWEEN @From AND @To
          AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
        GROUP BY rr.RosterRequirementId, rr.RequiredHC
      )
      SELECT SUM(RequiredHC) AS RequiredHC, SUM(ScheduledHC) AS ScheduledHC FROM PerRequirement
    `);
  const row = result.recordset[0];
  return { requiredHC: row?.RequiredHC ?? 0, scheduledHC: row?.ScheduledHC ?? 0 };
}

/** Company-wide, Process+Date-filtered only - same reasoning as getRosterAggregate. */
export async function getCallsAggregate(params: { from: string; to: string; processId?: number; serviceLevelThresholdSeconds: number }): Promise<{
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  answeredHandleSecondsSum: number;
  answeredWithinThreshold: number;
}> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .input("Threshold", sql.Int, params.serviceLevelThresholdSeconds ?? 20)
    .query<{ OfferedCalls: number; AnsweredCalls: number; AbandonedCalls: number; AnsweredHandleSecondsSum: number | null; AnsweredWithinThreshold: number }>(`
      SELECT
        COUNT(*) AS OfferedCalls,
        SUM(CASE WHEN q.Disposition = 'ANSWERED' THEN 1 ELSE 0 END) AS AnsweredCalls,
        SUM(CASE WHEN q.Disposition = 'ABANDONED' THEN 1 ELSE 0 END) AS AbandonedCalls,
        SUM(CASE WHEN q.Disposition = 'ANSWERED'
              THEN COALESCE(q.HandleSeconds, q.TalkSeconds + ISNULL(q.HoldSeconds, 0) + ISNULL(q.ACWSeconds, 0))
              ELSE 0 END) AS AnsweredHandleSecondsSum,
        SUM(CASE WHEN q.Disposition = 'ANSWERED' AND q.WaitSeconds IS NOT NULL AND q.WaitSeconds <= @Threshold THEN 1 ELSE 0 END) AS AnsweredWithinThreshold
      FROM [calls].QueueIntervalCall q
      LEFT JOIN [master].Queue mq ON mq.QueueId = q.QueueId
      WHERE q.BusinessDate BETWEEN @From AND @To
        AND (@ProcessId IS NULL OR mq.ProcessId = @ProcessId)
    `);
  const row = result.recordset[0];
  return {
    offeredCalls: row?.OfferedCalls ?? 0,
    answeredCalls: row?.AnsweredCalls ?? 0,
    abandonedCalls: row?.AbandonedCalls ?? 0,
    answeredHandleSecondsSum: row?.AnsweredHandleSecondsSum ?? 0,
    answeredWithinThreshold: row?.AnsweredWithinThreshold ?? 0,
  };
}

export interface EmployeeScheduleRow {
  employeeId: string;
  businessDate: string;
  shiftId: number | null;
  startTime: string | null;
  endTime: string | null;
  isOvernight: boolean | null;
  isWeeklyOff: boolean;
  isPresent: boolean;
}

/**
 * Row-level (one per scheduled employee/day), full HOD/TL/Agent-Senior/Designation/Process
 * filter applied via master.Employee - unlike the roster/calls aggregates above, Present
 * HC/Attendance %/Shrinkage % genuinely are per-employee questions, so the cascade applies.
 */
export async function listScheduledEmployees(params: ControlTowerFilters): Promise<EmployeeScheduleRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .input("HodId", sql.UniqueIdentifier, params.hodId ?? null)
    .input("TlId", sql.UniqueIdentifier, params.tlId ?? null)
    .input("AgentSeniorId", sql.UniqueIdentifier, params.agentSeniorId ?? null)
    .input("DesignationCode", sql.VarChar(30), params.designationCode ?? null)
    .query<{
      EmployeeId: string;
      BusinessDate: string;
      ShiftId: number | null;
      StartTime: string | null;
      EndTime: string | null;
      IsOvernight: boolean | null;
      IsWeeklyOff: boolean;
      IsPresent: boolean;
    }>(`
      SELECT
        pr.EmployeeId, CONVERT(VARCHAR(10), pr.BusinessDate, 23) AS BusinessDate, pr.ShiftId,
        CONVERT(VARCHAR(5), sh.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), sh.EndTime, 108) AS EndTime, sh.IsOvernight,
        pr.IsWeeklyOff,
        CAST(CASE WHEN EXISTS (SELECT 1 FROM [attendance].AttendanceSession att WHERE att.EmployeeId = pr.EmployeeId AND att.BusinessDate = pr.BusinessDate) THEN 1 ELSE 0 END AS BIT) AS IsPresent
      FROM [roster].PublishedRoster pr
      -- LEFT JOIN: a directly-published roster row (e.g. importIndiaTeamRoster.ts) has no RosterRequirementId at all and must still surface here.
      LEFT JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      JOIN [master].Employee e ON e.EmployeeId = pr.EmployeeId
      LEFT JOIN [master].Designation d ON d.DesignationId = e.DesignationId
      LEFT JOIN [master].Shift sh ON sh.ShiftId = pr.ShiftId
      WHERE pr.IsActive = 1 AND pr.BusinessDate BETWEEN @From AND @To
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
        AND (@HodId IS NULL OR e.UnitHodEmployeeId = @HodId)
        AND (@TlId IS NULL OR e.TeamLeaderEmployeeId = @TlId)
        AND (@AgentSeniorId IS NULL OR e.EmployeeId = @AgentSeniorId)
        AND (@DesignationCode IS NULL OR d.DesignationCode = @DesignationCode)
    `);
  return result.recordset.map((r) => ({
    employeeId: r.EmployeeId,
    businessDate: r.BusinessDate,
    shiftId: r.ShiftId,
    startTime: r.StartTime,
    endTime: r.EndTime,
    isOvernight: r.IsOvernight,
    isWeeklyOff: r.IsWeeklyOff,
    isPresent: r.IsPresent,
  }));
}

/** Shrinkage minutes for exactly the (employeeId, businessDate) pairs the caller already
 * resolved via listScheduledEmployees - same filtered population, not re-filtered independently. */
export async function getShrinkageMinutesForEmployees(params: { from: string; to: string; employeeIds: string[] }): Promise<number> {
  if (params.employeeIds.length === 0) return 0;
  const pool = await getPool();
  const request = pool.request().input("From", sql.Date, params.from).input("To", sql.Date, params.to);
  const placeholders = params.employeeIds.map((id, i) => {
    request.input(`Emp${i}`, sql.UniqueIdentifier, id);
    return `@Emp${i}`;
  });
  const result = await request.query<{ TotalMinutes: number | null }>(`
    SELECT SUM(Minutes) AS TotalMinutes
    FROM [shrinkage].ShrinkageEntry
    WHERE BusinessDate BETWEEN @From AND @To AND EmployeeId IN (${placeholders.join(", ")})
  `);
  return result.recordset[0]?.TotalMinutes ?? 0;
}
