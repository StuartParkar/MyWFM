import { getPool, sql } from "../../db/pool.js";

/**
 * All four "window" queries below return row-level data for exactly one business date (never a
 * range - Intraday Control is a single-day screen), leaving every bit of interval-bucketing
 * math to intraday.service.ts. This mirrors staffing.repository.ts's
 * listPublishedRosterKeysByProcess precedent: SQL cannot do the timezone-aware "does this
 * instant fall in this bucket" comparison computeScheduledWindow/combineLocalDateTime already
 * own, so rows are handed over raw rather than pre-aggregated.
 *
 * Each query applies the same `(@ProcessId IS NULL OR ... = @ProcessId)` optional filter used
 * throughout Control Tower/Staffing - a LEFT JOIN out to RosterRequirement/Queue means a row
 * with no resolvable process (e.g. attendance with no published roster that day, a queue never
 * assigned a process - see Admin > Queues) is naturally excluded only when a specific process
 * is requested, never silently miscounted, and still contributes to the company-wide (no
 * filter) view.
 */

export interface RequirementWindowRow {
  requiredHC: number;
  shiftId: number;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
}

/**
 * Only requirements with a named Shift can be placed on the interval timeline at all - a
 * requirement submitted without one (roster.validation.ts's shiftId is nullish - a real,
 * allowed case) has no resolvable window and is therefore excluded here specifically, though it
 * still counts in Staffing Coverage/Control Tower's day-grain totals. See
 * documentation/intraday.md.
 */
export async function listRequirementWindows(params: { businessDate: string; processId?: number }): Promise<RequirementWindowRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ RequiredHC: number; ShiftId: number; StartTime: string; EndTime: string; IsOvernight: boolean }>(`
      SELECT rr.RequiredHC, rr.ShiftId, CONVERT(VARCHAR(5), sh.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), sh.EndTime, 108) AS EndTime, sh.IsOvernight
      FROM [roster].RosterRequirement rr
      JOIN [master].Shift sh ON sh.ShiftId = rr.ShiftId
      WHERE rr.Status = 'PUBLISHED' AND rr.BusinessDate = @BusinessDate
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
    `);
  return result.recordset.map((r) => ({ requiredHC: r.RequiredHC, shiftId: r.ShiftId, startTime: r.StartTime, endTime: r.EndTime, isOvernight: r.IsOvernight }));
}

export interface ScheduledEmployeeWindowRow {
  employeeId: string;
  shiftId: number | null;
  startTime: string | null;
  endTime: string | null;
  isOvernight: boolean | null;
  isWeeklyOff: boolean;
}

export async function listScheduledEmployeeWindows(params: { businessDate: string; processId?: number }): Promise<ScheduledEmployeeWindowRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ EmployeeId: string; ShiftId: number | null; StartTime: string | null; EndTime: string | null; IsOvernight: boolean | null; IsWeeklyOff: boolean }>(`
      SELECT pr.EmployeeId, pr.ShiftId, CONVERT(VARCHAR(5), sh.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), sh.EndTime, 108) AS EndTime, sh.IsOvernight, pr.IsWeeklyOff
      FROM [roster].PublishedRoster pr
      JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      LEFT JOIN [master].Shift sh ON sh.ShiftId = pr.ShiftId
      WHERE pr.IsActive = 1 AND pr.BusinessDate = @BusinessDate
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
    `);
  return result.recordset.map((r) => ({
    employeeId: r.EmployeeId,
    shiftId: r.ShiftId,
    startTime: r.StartTime,
    endTime: r.EndTime,
    isOvernight: r.IsOvernight,
    isWeeklyOff: r.IsWeeklyOff,
  }));
}

export interface AttendanceWindowRow {
  employeeId: string;
  sessionStart: string;
  sessionEnd: string | null;
}

export async function listAttendanceWindows(params: { businessDate: string; processId?: number }): Promise<AttendanceWindowRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ EmployeeId: string; SessionStart: Date; SessionEnd: Date | null }>(`
      SELECT att.EmployeeId, att.SessionStart, att.SessionEnd
      FROM [attendance].AttendanceSession att
      LEFT JOIN [roster].PublishedRoster pr ON pr.EmployeeId = att.EmployeeId AND pr.BusinessDate = att.BusinessDate AND pr.IsActive = 1
      LEFT JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      WHERE att.BusinessDate = @BusinessDate
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
    `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, sessionStart: r.SessionStart.toISOString(), sessionEnd: r.SessionEnd ? r.SessionEnd.toISOString() : null }));
}

export interface BreakWindowRow {
  employeeId: string;
  breakStart: string;
  breakEnd: string | null;
}

export async function listBreakWindows(params: { businessDate: string; processId?: number }): Promise<BreakWindowRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ EmployeeId: string; BreakStart: Date; BreakEnd: Date | null }>(`
      SELECT bs.EmployeeId, bs.BreakStart, bs.BreakEnd
      FROM [attendance].BreakSession bs
      LEFT JOIN [roster].PublishedRoster pr ON pr.EmployeeId = bs.EmployeeId AND pr.BusinessDate = bs.BusinessDate AND pr.IsActive = 1
      LEFT JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      WHERE bs.BusinessDate = @BusinessDate
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
    `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, breakStart: r.BreakStart.toISOString(), breakEnd: r.BreakEnd ? r.BreakEnd.toISOString() : null }));
}

export interface CallEventRow {
  intervalStart: string;
  answered: boolean;
  abandoned: boolean;
  handleSeconds: number;
  answeredWithinThreshold: boolean;
}

/**
 * One row per real call (build spec section 76's call-detail model, migration 0011) - never
 * pre-aggregated, so bucketing by "which configured interval contains this call's own
 * IntervalStart" (done in TS, see intraday.service.ts) is exact for any bucket width, not an
 * approximation of some other fixed source granularity.
 */
export async function listCallEvents(params: { businessDate: string; processId?: number; serviceLevelThresholdSeconds: number }): Promise<CallEventRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .input("Threshold", sql.Int, params.serviceLevelThresholdSeconds)
    .query<{ IntervalStart: Date; Answered: boolean; Abandoned: boolean; HandleSeconds: number | null; AnsweredWithinThreshold: boolean }>(`
      SELECT
        q.IntervalStart,
        CAST(CASE WHEN q.Disposition = 'ANSWERED' THEN 1 ELSE 0 END AS BIT) AS Answered,
        CAST(CASE WHEN q.Disposition = 'ABANDONED' THEN 1 ELSE 0 END AS BIT) AS Abandoned,
        CASE WHEN q.Disposition = 'ANSWERED' THEN COALESCE(q.HandleSeconds, q.TalkSeconds + ISNULL(q.HoldSeconds, 0) + ISNULL(q.ACWSeconds, 0)) ELSE 0 END AS HandleSeconds,
        CAST(CASE WHEN q.Disposition = 'ANSWERED' AND q.WaitSeconds IS NOT NULL AND q.WaitSeconds <= @Threshold THEN 1 ELSE 0 END AS BIT) AS AnsweredWithinThreshold
      FROM [calls].QueueIntervalCall q
      LEFT JOIN [master].Queue mq ON mq.QueueId = q.QueueId
      WHERE q.BusinessDate = @BusinessDate
        AND (@ProcessId IS NULL OR mq.ProcessId = @ProcessId)
    `);
  return result.recordset.map((r) => ({
    intervalStart: r.IntervalStart.toISOString(),
    answered: r.Answered,
    abandoned: r.Abandoned,
    handleSeconds: r.HandleSeconds ?? 0,
    answeredWithinThreshold: r.AnsweredWithinThreshold,
  }));
}

// ---------------------------------------------------------------------------
// Break Management (attendance.BreakSession CRUD) - real, managed records, unlike the read-only
// listBreakWindows above which only feeds the interval-bucketing engine.
// ---------------------------------------------------------------------------

export async function createBreakSession(input: { employeeId: string; businessDate: string; breakStart: string; createdByUserId: string }): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, input.employeeId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("BreakStart", sql.DateTime2, new Date(input.breakStart))
    .input("CreatedByUserId", sql.UniqueIdentifier, input.createdByUserId)
    .query<{ BreakSessionId: number }>(`
      INSERT INTO [attendance].BreakSession (EmployeeId, BusinessDate, BreakStart, Source, CreatedByUserId)
      OUTPUT INSERTED.BreakSessionId
      VALUES (@EmployeeId, @BusinessDate, @BreakStart, 'MANUAL', @CreatedByUserId)
    `);
  return result.recordset[0]!.BreakSessionId;
}

export interface BreakSessionRow {
  breakSessionId: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  breakStart: string;
  breakEnd: string | null;
}

export async function getBreakSession(id: number): Promise<BreakSessionRow | null> {
  const pool = await getPool();
  const result = await pool.request().input("Id", sql.BigInt, id).query<{
    BreakSessionId: number;
    EmployeeId: string;
    EmployeeCode: string;
    EmployeeName: string;
    BusinessDate: string;
    BreakStart: Date;
    BreakEnd: Date | null;
  }>(`
    SELECT bs.BreakSessionId, bs.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS EmployeeName,
           CONVERT(VARCHAR(10), bs.BusinessDate, 23) AS BusinessDate, bs.BreakStart, bs.BreakEnd
    FROM [attendance].BreakSession bs
    JOIN [master].Employee e ON e.EmployeeId = bs.EmployeeId
    WHERE bs.BreakSessionId = @Id
  `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    breakSessionId: row.BreakSessionId,
    employeeId: row.EmployeeId,
    employeeCode: row.EmployeeCode,
    employeeName: row.EmployeeName,
    businessDate: row.BusinessDate,
    breakStart: row.BreakStart.toISOString(),
    breakEnd: row.BreakEnd ? row.BreakEnd.toISOString() : null,
  };
}

/** Guarded by `AND BreakEnd IS NULL` - ending an already-ended break is a no-op, not a silent overwrite of a real recorded end time. */
export async function endBreakSession(id: number, breakEnd: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.BigInt, id)
    .input("BreakEnd", sql.DateTime2, new Date(breakEnd))
    .query(`UPDATE [attendance].BreakSession SET BreakEnd = @BreakEnd WHERE BreakSessionId = @Id AND BreakEnd IS NULL`);
}

export async function listBreakSessionsForDate(params: { businessDate: string; processId?: number }): Promise<BreakSessionRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ BreakSessionId: number; EmployeeId: string; EmployeeCode: string; EmployeeName: string; BusinessDate: string; BreakStart: Date; BreakEnd: Date | null }>(`
      SELECT bs.BreakSessionId, bs.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS EmployeeName,
             CONVERT(VARCHAR(10), bs.BusinessDate, 23) AS BusinessDate, bs.BreakStart, bs.BreakEnd
      FROM [attendance].BreakSession bs
      JOIN [master].Employee e ON e.EmployeeId = bs.EmployeeId
      LEFT JOIN [roster].PublishedRoster pr ON pr.EmployeeId = bs.EmployeeId AND pr.BusinessDate = bs.BusinessDate AND pr.IsActive = 1
      LEFT JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      WHERE bs.BusinessDate = @BusinessDate
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
      ORDER BY bs.BreakStart DESC
    `);
  return result.recordset.map((r) => ({
    breakSessionId: r.BreakSessionId,
    employeeId: r.EmployeeId,
    employeeCode: r.EmployeeCode,
    employeeName: r.EmployeeName,
    businessDate: r.BusinessDate,
    breakStart: r.BreakStart.toISOString(),
    breakEnd: r.BreakEnd ? r.BreakEnd.toISOString() : null,
  }));
}

/** Scheduled employees for a business date, for Break Management's "start a break for..." picker - reuses the same shape/filter as listScheduledEmployeeWindows but with display name/code joined in. */
export async function listScheduledEmployeesForDate(params: { businessDate: string; processId?: number }): Promise<{ employeeId: string; employeeCode: string; employeeName: string }[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .query<{ EmployeeId: string; EmployeeCode: string; EmployeeName: string }>(`
      SELECT DISTINCT pr.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS EmployeeName
      FROM [roster].PublishedRoster pr
      JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      JOIN [master].Employee e ON e.EmployeeId = pr.EmployeeId
      WHERE pr.IsActive = 1 AND pr.BusinessDate = @BusinessDate AND pr.IsWeeklyOff = 0
        AND (@ProcessId IS NULL OR rr.ProcessId = @ProcessId)
      ORDER BY COALESCE(e.AliasName, e.FullName)
    `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, employeeCode: r.EmployeeCode, employeeName: r.EmployeeName }));
}

// ---------------------------------------------------------------------------
// Exception engine (intraday.ExceptionRule / intraday.Exception)
// ---------------------------------------------------------------------------

export type ComparisonOperator = "<" | "<=" | ">" | ">=";

export interface ExceptionRuleRow {
  exceptionRuleId: number;
  ruleCode: string;
  category: "STAFFING" | "SERVICE_LEVEL" | "ATTENDANCE" | "DATA_QUALITY";
  description: string;
  comparisonOperator: ComparisonOperator;
  thresholdValue: number;
}

export async function listActiveExceptionRules(): Promise<ExceptionRuleRow[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ ExceptionRuleId: number; RuleCode: string; Category: string; Description: string; ComparisonOperator: string; ThresholdValue: number }>(`
    SELECT ExceptionRuleId, RuleCode, Category, Description, ComparisonOperator, ThresholdValue
    FROM [intraday].ExceptionRule WHERE IsActive = 1
  `);
  return result.recordset.map((r) => ({
    exceptionRuleId: r.ExceptionRuleId,
    ruleCode: r.RuleCode,
    category: r.Category as ExceptionRuleRow["category"],
    description: r.Description,
    comparisonOperator: r.ComparisonOperator as ComparisonOperator,
    thresholdValue: r.ThresholdValue,
  }));
}

/**
 * Detection runs on demand (no cron - see documentation/troubleshooting.md), so this must be
 * safe to call repeatedly for the same real breach without spamming duplicate rows: it only
 * inserts when no OPEN (non-RESOLVED) exception already exists for this exact
 * (rule, entity, businessDate, intervalStart) key - the same key the UX_Exception_OpenDedup
 * filtered unique index enforces, checked explicitly here (rather than caught as a duplicate-key
 * error) so a repeat scan's "nothing new" case is the ordinary path, not an exception path.
 * Returns the new ExceptionId, or null when a matching open exception already existed.
 */
export async function ensureException(input: {
  exceptionRuleId: number;
  entityType: string;
  entityId: string;
  businessDate: string;
  intervalStart: string;
  observedValue: number;
  thresholdValue: number;
}): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("RuleId", sql.Int, input.exceptionRuleId)
    .input("EntityType", sql.VarChar(50), input.entityType)
    .input("EntityId", sql.VarChar(100), input.entityId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("IntervalStart", sql.DateTime2, new Date(input.intervalStart))
    .input("ObservedValue", sql.Decimal(18, 4), input.observedValue)
    .input("ThresholdValue", sql.Decimal(18, 4), input.thresholdValue)
    .query<{ ExceptionId: number }>(`
      IF NOT EXISTS (
        SELECT 1 FROM [intraday].Exception
        WHERE ExceptionRuleId = @RuleId AND EntityType = @EntityType AND EntityId = @EntityId
          AND BusinessDate = @BusinessDate AND IntervalStart = @IntervalStart AND Status <> 'RESOLVED'
      )
      BEGIN
        INSERT INTO [intraday].Exception (ExceptionRuleId, EntityType, EntityId, BusinessDate, IntervalStart, ObservedValue, ThresholdValue)
        OUTPUT INSERTED.ExceptionId
        VALUES (@RuleId, @EntityType, @EntityId, @BusinessDate, @IntervalStart, @ObservedValue, @ThresholdValue)
      END
    `);
  return result.recordset[0]?.ExceptionId ?? null;
}

export interface DataQualityBreachRow {
  importRunId: number;
  businessDate: string;
  highSeverityOpenCount: number;
}

/** Not scoped to any businessDate parameter - an import run isn't naturally "on" the date a
 * scan happens to be viewing, so this evaluates every import run's own current state and uses
 * its own business period (or upload date, if no period was recorded) as the exception's
 * BusinessDate. See documentation/intraday.md. */
export async function listHighSeverityDataQualityBreaches(threshold: number): Promise<DataQualityBreachRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Threshold", sql.Int, threshold)
    .query<{ ImportRunId: number; BusinessDate: string; HighSeverityOpenCount: number }>(`
      SELECT ir.ImportRunId,
             CONVERT(VARCHAR(10), COALESCE(ir.BusinessPeriodEnd, ir.BusinessPeriodStart, CAST(ir.UploadedAt AS DATE)), 23) AS BusinessDate,
             COUNT(*) AS HighSeverityOpenCount
      FROM [import].DataQualityIssue dq
      JOIN [import].ImportRun ir ON ir.ImportRunId = dq.ImportRunId
      WHERE dq.Severity = 'HIGH' AND dq.Status = 'OPEN'
      GROUP BY ir.ImportRunId, COALESCE(ir.BusinessPeriodEnd, ir.BusinessPeriodStart, CAST(ir.UploadedAt AS DATE))
      HAVING COUNT(*) > @Threshold
    `);
  return result.recordset.map((r) => ({ importRunId: r.ImportRunId, businessDate: r.BusinessDate, highSeverityOpenCount: r.HighSeverityOpenCount }));
}

export interface ExceptionListRow {
  exceptionId: number;
  ruleCode: string;
  category: string;
  ruleDescription: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  intervalStart: string;
  observedValue: number;
  thresholdValue: number;
  status: "DETECTED" | "ACKNOWLEDGED" | "ACTION_TAKEN" | "RESOLVED";
  detectedAt: string;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  actionTaken: string | null;
  actionByName: string | null;
  actionAt: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
}

/**
 * `excludeResolved` and `status` are mutually exclusive filters, chosen by the caller (never
 * both): the Actions work-queue view passes `excludeResolved: true` (any still-open status);
 * the Exceptions browse view passes neither (everything, including history) or a specific
 * `status` to look at just one lifecycle stage.
 */
export async function listExceptions(params: { status?: string; excludeResolved?: boolean; category?: string; from?: string; to?: string }): Promise<ExceptionListRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Status", sql.VarChar(20), params.status ?? null)
    .input("ExcludeResolved", sql.Bit, params.excludeResolved ?? false)
    .input("Category", sql.VarChar(20), params.category ?? null)
    .input("From", sql.Date, params.from ?? null)
    .input("To", sql.Date, params.to ?? null)
    .query<{
      ExceptionId: number;
      RuleCode: string;
      Category: string;
      RuleDescription: string;
      EntityType: string;
      EntityId: string;
      BusinessDate: string;
      IntervalStart: Date;
      ObservedValue: number;
      ThresholdValue: number;
      Status: string;
      DetectedAt: Date;
      AcknowledgedByName: string | null;
      AcknowledgedAt: Date | null;
      ActionTaken: string | null;
      ActionByName: string | null;
      ActionAt: Date | null;
      ResolvedByName: string | null;
      ResolvedAt: Date | null;
      ResolutionNotes: string | null;
    }>(`
      SELECT
        x.ExceptionId, r.RuleCode, r.Category, r.Description AS RuleDescription,
        x.EntityType, x.EntityId, CONVERT(VARCHAR(10), x.BusinessDate, 23) AS BusinessDate, x.IntervalStart,
        x.ObservedValue, x.ThresholdValue, x.Status, x.DetectedAt,
        ackUser.DisplayName AS AcknowledgedByName, x.AcknowledgedAt,
        x.ActionTaken, actionUser.DisplayName AS ActionByName, x.ActionAt,
        resolvedUser.DisplayName AS ResolvedByName, x.ResolvedAt, x.ResolutionNotes
      FROM [intraday].Exception x
      JOIN [intraday].ExceptionRule r ON r.ExceptionRuleId = x.ExceptionRuleId
      LEFT JOIN security.[User] ackUser ON ackUser.UserId = x.AcknowledgedByUserId
      LEFT JOIN security.[User] actionUser ON actionUser.UserId = x.ActionByUserId
      LEFT JOIN security.[User] resolvedUser ON resolvedUser.UserId = x.ResolvedByUserId
      WHERE (@Status IS NULL OR x.Status = @Status)
        AND (@ExcludeResolved = 0 OR x.Status <> 'RESOLVED')
        AND (@Category IS NULL OR r.Category = @Category)
        AND (@From IS NULL OR x.BusinessDate >= @From)
        AND (@To IS NULL OR x.BusinessDate <= @To)
      ORDER BY x.DetectedAt DESC
    `);
  return result.recordset.map((r) => ({
    exceptionId: r.ExceptionId,
    ruleCode: r.RuleCode,
    category: r.Category,
    ruleDescription: r.RuleDescription,
    entityType: r.EntityType,
    entityId: r.EntityId,
    businessDate: r.BusinessDate,
    intervalStart: r.IntervalStart.toISOString(),
    observedValue: r.ObservedValue,
    thresholdValue: r.ThresholdValue,
    status: r.Status as ExceptionListRow["status"],
    detectedAt: r.DetectedAt.toISOString(),
    acknowledgedByName: r.AcknowledgedByName,
    acknowledgedAt: r.AcknowledgedAt ? r.AcknowledgedAt.toISOString() : null,
    actionTaken: r.ActionTaken,
    actionByName: r.ActionByName,
    actionAt: r.ActionAt ? r.ActionAt.toISOString() : null,
    resolvedByName: r.ResolvedByName,
    resolvedAt: r.ResolvedAt ? r.ResolvedAt.toISOString() : null,
    resolutionNotes: r.ResolutionNotes,
  }));
}

export interface ExceptionRow {
  exceptionId: number;
  status: ExceptionListRow["status"];
}

export async function getExceptionStatus(id: number): Promise<ExceptionRow | null> {
  const pool = await getPool();
  const result = await pool.request().input("Id", sql.BigInt, id).query<{ ExceptionId: number; Status: string }>(`
    SELECT ExceptionId, Status FROM [intraday].Exception WHERE ExceptionId = @Id
  `);
  const row = result.recordset[0];
  return row ? { exceptionId: row.ExceptionId, status: row.Status as ExceptionListRow["status"] } : null;
}

export async function acknowledgeException(id: number, userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.BigInt, id)
    .input("UserId", sql.UniqueIdentifier, userId)
    .query(`UPDATE [intraday].Exception SET Status = 'ACKNOWLEDGED', AcknowledgedByUserId = @UserId, AcknowledgedAt = SYSUTCDATETIME() WHERE ExceptionId = @Id AND Status = 'DETECTED'`);
}

export async function recordExceptionAction(id: number, actionTaken: string, userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.BigInt, id)
    .input("ActionTaken", sql.NVarChar(500), actionTaken)
    .input("UserId", sql.UniqueIdentifier, userId)
    .query(`UPDATE [intraday].Exception SET Status = 'ACTION_TAKEN', ActionTaken = @ActionTaken, ActionByUserId = @UserId, ActionAt = SYSUTCDATETIME() WHERE ExceptionId = @Id AND Status = 'ACKNOWLEDGED'`);
}

export async function resolveException(id: number, resolutionNotes: string | null, userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.BigInt, id)
    .input("ResolutionNotes", sql.NVarChar(500), resolutionNotes)
    .input("UserId", sql.UniqueIdentifier, userId)
    .query(`UPDATE [intraday].Exception SET Status = 'RESOLVED', ResolutionNotes = @ResolutionNotes, ResolvedByUserId = @UserId, ResolvedAt = SYSUTCDATETIME() WHERE ExceptionId = @Id AND Status = 'ACTION_TAKEN'`);
}

// ---------------------------------------------------------------------------
// OT/VTO (intraday.CapacityAdjustmentRequest)
// ---------------------------------------------------------------------------

/** No code anywhere reads security.User.EmployeeId yet (it has existed, unused, since Phase 2's
 * migration 0004) - OT/VTO self-service is the first feature that needs "which employee is the
 * logged-in user", so this is the one place that link is resolved. */
export async function getEmployeeIdForUser(userId: string): Promise<string | null> {
  const pool = await getPool();
  const result = await pool.request().input("UserId", sql.UniqueIdentifier, userId).query<{ EmployeeId: string | null }>(`
    SELECT EmployeeId FROM security.[User] WHERE UserId = @UserId
  `);
  return result.recordset[0]?.EmployeeId ?? null;
}

export interface ScheduledWindowForEmployeeRow {
  processId: number | null;
  shiftId: number | null;
  startTime: string | null;
  endTime: string | null;
  isOvernight: boolean | null;
  isWeeklyOff: boolean;
}

export async function getScheduledWindowForEmployee(employeeId: string, businessDate: string): Promise<ScheduledWindowForEmployeeRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .input("BusinessDate", sql.Date, businessDate)
    .query<{ ProcessId: number | null; ShiftId: number | null; StartTime: string | null; EndTime: string | null; IsOvernight: boolean | null; IsWeeklyOff: boolean }>(`
      SELECT rr.ProcessId, pr.ShiftId, CONVERT(VARCHAR(5), sh.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), sh.EndTime, 108) AS EndTime, sh.IsOvernight, pr.IsWeeklyOff
      FROM [roster].PublishedRoster pr
      JOIN [roster].RosterRequirement rr ON rr.RosterRequirementId = pr.RosterRequirementId
      LEFT JOIN [master].Shift sh ON sh.ShiftId = pr.ShiftId
      WHERE pr.IsActive = 1 AND pr.EmployeeId = @EmployeeId AND pr.BusinessDate = @BusinessDate
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return { processId: row.ProcessId, shiftId: row.ShiftId, startTime: row.StartTime, endTime: row.EndTime, isOvernight: row.IsOvernight, isWeeklyOff: row.IsWeeklyOff };
}

export type CapacityRequestType = "OVERTIME" | "VTO";
export type CapacityRequestStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";

export async function createCapacityRequest(input: {
  requestType: CapacityRequestType;
  employeeId: string;
  businessDate: string;
  hoursRequested: number;
  reason: string | null;
  requestedByUserId: string;
}): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("RequestType", sql.VarChar(10), input.requestType)
    .input("EmployeeId", sql.UniqueIdentifier, input.employeeId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("HoursRequested", sql.Decimal(5, 2), input.hoursRequested)
    .input("Reason", sql.NVarChar(300), input.reason)
    .input("RequestedByUserId", sql.UniqueIdentifier, input.requestedByUserId)
    .query<{ RequestId: number }>(`
      INSERT INTO [intraday].CapacityAdjustmentRequest (RequestType, EmployeeId, BusinessDate, HoursRequested, Reason, RequestedByUserId)
      OUTPUT INSERTED.RequestId
      VALUES (@RequestType, @EmployeeId, @BusinessDate, @HoursRequested, @Reason, @RequestedByUserId)
    `);
  return result.recordset[0]!.RequestId;
}

export interface CapacityRequestRow {
  requestId: number;
  requestType: CapacityRequestType;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  hoursRequested: number;
  reason: string | null;
  status: CapacityRequestStatus;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
}

function mapCapacityRequestRow(r: {
  RequestId: number;
  RequestType: string;
  EmployeeId: string;
  EmployeeCode: string;
  EmployeeName: string;
  BusinessDate: string;
  HoursRequested: number;
  Reason: string | null;
  Status: string;
  RequestedByUserId: string;
  RequestedByName: string;
  RequestedAt: Date;
  DecidedByName: string | null;
  DecidedAt: Date | null;
  DecisionNotes: string | null;
}): CapacityRequestRow {
  return {
    requestId: r.RequestId,
    requestType: r.RequestType as CapacityRequestType,
    employeeId: r.EmployeeId,
    employeeCode: r.EmployeeCode,
    employeeName: r.EmployeeName,
    businessDate: r.BusinessDate,
    hoursRequested: r.HoursRequested,
    reason: r.Reason,
    status: r.Status as CapacityRequestStatus,
    requestedByUserId: r.RequestedByUserId,
    requestedByName: r.RequestedByName,
    requestedAt: r.RequestedAt.toISOString(),
    decidedByName: r.DecidedByName,
    decidedAt: r.DecidedAt ? r.DecidedAt.toISOString() : null,
    decisionNotes: r.DecisionNotes,
  };
}

const CAPACITY_REQUEST_SELECT = `
  SELECT
    req.RequestId, req.RequestType, req.EmployeeId, e.EmployeeCode, COALESCE(e.AliasName, e.FullName) AS EmployeeName,
    CONVERT(VARCHAR(10), req.BusinessDate, 23) AS BusinessDate, req.HoursRequested, req.Reason, req.Status,
    req.RequestedByUserId, requestedByUser.DisplayName AS RequestedByName, req.RequestedAt,
    decidedByUser.DisplayName AS DecidedByName, req.DecidedAt, req.DecisionNotes
  FROM [intraday].CapacityAdjustmentRequest req
  JOIN [master].Employee e ON e.EmployeeId = req.EmployeeId
  JOIN security.[User] requestedByUser ON requestedByUser.UserId = req.RequestedByUserId
  LEFT JOIN security.[User] decidedByUser ON decidedByUser.UserId = req.DecidedByUserId
`;

export async function getCapacityRequest(id: number): Promise<CapacityRequestRow | null> {
  const pool = await getPool();
  const result = await pool.request().input("Id", sql.Int, id).query(`${CAPACITY_REQUEST_SELECT} WHERE req.RequestId = @Id`);
  const row = result.recordset[0];
  return row ? mapCapacityRequestRow(row) : null;
}

export async function listCapacityRequests(params: { businessDate?: string; status?: string; employeeId?: string }): Promise<CapacityRequestRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, params.businessDate ?? null)
    .input("Status", sql.VarChar(20), params.status ?? null)
    .input("EmployeeId", sql.UniqueIdentifier, params.employeeId ?? null)
    .query(`
      ${CAPACITY_REQUEST_SELECT}
      WHERE (@BusinessDate IS NULL OR req.BusinessDate = @BusinessDate)
        AND (@Status IS NULL OR req.Status = @Status)
        AND (@EmployeeId IS NULL OR req.EmployeeId = @EmployeeId)
      ORDER BY req.RequestedAt DESC
    `);
  return result.recordset.map(mapCapacityRequestRow);
}

export async function decideCapacityRequest(id: number, status: "APPROVED" | "REJECTED", decisionNotes: string | null, userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.Int, id)
    .input("Status", sql.VarChar(20), status)
    .input("DecisionNotes", sql.NVarChar(300), decisionNotes)
    .input("UserId", sql.UniqueIdentifier, userId)
    .query(`
      UPDATE [intraday].CapacityAdjustmentRequest
      SET Status = @Status, DecisionNotes = @DecisionNotes, DecidedByUserId = @UserId, DecidedAt = SYSUTCDATETIME()
      WHERE RequestId = @Id AND Status = 'REQUESTED'
    `);
}

export async function cancelCapacityRequest(id: number, userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.Int, id)
    .input("UserId", sql.UniqueIdentifier, userId)
    .query(`
      UPDATE [intraday].CapacityAdjustmentRequest
      SET Status = 'CANCELLED', DecidedByUserId = @UserId, DecidedAt = SYSUTCDATETIME()
      WHERE RequestId = @Id AND Status = 'REQUESTED'
    `);
}
