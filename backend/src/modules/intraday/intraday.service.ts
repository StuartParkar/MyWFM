import { addDays, combineLocalDateTime } from "@mywfm/shared";
import { getConfigNumber, getConfigString } from "../../config/appConfig.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAudit } from "../audit/audit.service.js";
import { computeScheduledWindow, listDailySummaries } from "../attendance/attendance.service.js";
import { listProcesses } from "../masterdata/masterdata.repository.js";
import { recordCalculation } from "../formula/calculationLedger.js";
import * as repo from "./intraday.repository.js";

export interface IntervalBucket {
  intervalStart: string;
  label: string;
  requiredHC: number;
  scheduledHC: number;
  presentHC: number;
  availableHC: number;
  staffingGap: number;
  availableStaffingGap: number;
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  ahtSeconds: number | null;
  serviceLevelPct: number | null;
  occupancyPct: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BucketBoundary {
  startIso: string;
  label: string;
}

/**
 * Buckets normally span exactly businessDate's own 00:00-24:00 (`endIso` = next calendar day's
 * midnight), but an overnight shift genuinely owned by this business date (e.g. 22:00-02:00,
 * per the Business Day Engine's own resolveBusinessDate rule) ends past that boundary -
 * `getIntervalSummary` extends `endIso` to the latest real scheduledEnd it finds before calling
 * this, so that spillover is never silently dropped from either day's view. `offset` is real
 * elapsed minutes from businessDate's own midnight, not clock time, so a bucket past calendar
 * midnight correctly resolves to the next calendar date via combineLocalDateTime rather than an
 * invalid "25:30"-style time string.
 */
function buildBuckets(businessDate: string, intervalMinutes: number, tz: string, endIso: string): BucketBoundary[] {
  const buckets: BucketBoundary[] = [];
  const endMs = new Date(endIso).getTime();
  for (let offset = 0; ; offset += intervalMinutes) {
    const dayOffset = Math.floor(offset / 1440);
    const minuteOfDay = offset % 1440;
    const hhmm = `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
    const date = dayOffset === 0 ? businessDate : addDays(businessDate, dayOffset);
    const startIso = combineLocalDateTime(date, hhmm, tz);
    if (new Date(startIso).getTime() >= endMs) break;
    buckets.push({ startIso, label: dayOffset === 0 ? hhmm : `${hhmm} (+${dayOffset}d)` });
  }
  return buckets;
}

/**
 * Sampled at the bucket's own start instant (the standard "headcount as of the top of the
 * interval" WFM convention) rather than by fractional overlap - an employee scheduled 09:00-18:00
 * counts toward every bucket from 09:00 up to (not including) 18:00, whatever the bucket width.
 */
function windowCoversInstant(windowStartIso: string | null, windowEndIso: string | null, instantIso: string): boolean {
  if (!windowStartIso || !windowEndIso) return false;
  const t = new Date(instantIso).getTime();
  return t >= new Date(windowStartIso).getTime() && t < new Date(windowEndIso).getTime();
}

/** Which bucket a single point-in-time event (a call's own IntervalStart) falls into. */
function bucketIndexForInstant(instantIso: string, buckets: BucketBoundary[], endOfDayIso: string): number | null {
  const t = new Date(instantIso).getTime();
  for (let i = 0; i < buckets.length; i++) {
    const start = new Date(buckets[i]!.startIso).getTime();
    const end = i + 1 < buckets.length ? new Date(buckets[i + 1]!.startIso).getTime() : new Date(endOfDayIso).getTime();
    if (t >= start && t < end) return i;
  }
  return null;
}

/**
 * Build spec section 20's interval-level view: Required/Scheduled/Present/Available HC, Gap,
 * Calls, AHT, Occupancy, Service Level, bucketed into a configurable interval
 * (intraday.interval_minutes) across exactly one business date. No new schema (see migration
 * 0012_intraday.sql's header comment) - every number here is derived on read from
 * Shift/PublishedRoster/AttendanceSession/BreakSession/QueueIntervalCall rows already recorded
 * by earlier phases.
 *
 * Process-filterable only, like Control Tower's Group A (roster/calls aren't "for" one
 * employee) - but here Present/Available HC join the same filter instead of needing their own
 * HOD/TL/Agent-Senior cascade, because Intraday Control is a single scope's timeline, not a
 * multi-employee roster grid. See documentation/intraday.md.
 */
export async function getIntervalSummary(params: { businessDate: string; processId?: number; computedByUserId?: string }): Promise<IntervalBucket[]> {
  const tz = getConfigString("business_day.timezone", "Asia/Kolkata");
  const intervalMinutes = getConfigNumber("intraday.interval_minutes", 30);
  const serviceLevelThresholdSeconds = getConfigNumber("calls.service_level_threshold_seconds", 20);

  const [requirementWindows, scheduleWindows, attendanceWindows, breakWindows, callEvents] = await Promise.all([
    repo.listRequirementWindows({ businessDate: params.businessDate, processId: params.processId }),
    repo.listScheduledEmployeeWindows({ businessDate: params.businessDate, processId: params.processId }),
    repo.listAttendanceWindows({ businessDate: params.businessDate, processId: params.processId }),
    repo.listBreakWindows({ businessDate: params.businessDate, processId: params.processId }),
    repo.listCallEvents({ businessDate: params.businessDate, processId: params.processId, serviceLevelThresholdSeconds }),
  ]);

  const bucketHours = intervalMinutes / 60;

  // Precompute each real-world window once (not per bucket) - the timezone-aware overnight
  // rollover math (computeScheduledWindow) is the same per row regardless of how many buckets
  // it happens to cover.
  const requirementRanges = requirementWindows.map((w) => ({
    requiredHC: w.requiredHC,
    ...computeScheduledWindow({ businessDate: params.businessDate, shiftId: w.shiftId, startTime: w.startTime, endTime: w.endTime, isOvernight: w.isOvernight, isWeeklyOff: false }, tz),
  }));
  const scheduleRanges = scheduleWindows.map((w) => computeScheduledWindow({ businessDate: params.businessDate, shiftId: w.shiftId, startTime: w.startTime, endTime: w.endTime, isOvernight: w.isOvernight, isWeeklyOff: w.isWeeklyOff }, tz));

  // Buckets must cover every real shift's full window for this business date - an overnight
  // shift (e.g. 22:00-02:00) genuinely ends after calendar midnight, so the standard "next
  // calendar day's midnight" boundary is extended only as far as the latest real scheduledEnd
  // actually requires, never by a fixed guessed amount. See buildBuckets and
  // documentation/intraday.md.
  let endOfDayIso = combineLocalDateTime(addDays(params.businessDate, 1), "00:00", tz);
  for (const r of [...requirementRanges, ...scheduleRanges]) {
    if (r.scheduledEnd && new Date(r.scheduledEnd).getTime() > new Date(endOfDayIso).getTime()) endOfDayIso = r.scheduledEnd;
  }
  const buckets = buildBuckets(params.businessDate, intervalMinutes, tz, endOfDayIso);

  // An open SessionEnd/BreakEnd (still ongoing) covers through the end of this business date -
  // the same "ongoing" convention BreakSession's own DDL comment documents for AttendanceSession.
  const attendanceRanges = attendanceWindows.map((w) => ({ employeeId: w.employeeId, start: w.sessionStart, end: w.sessionEnd ?? endOfDayIso }));
  const breakRanges = breakWindows.map((w) => ({ employeeId: w.employeeId, start: w.breakStart, end: w.breakEnd ?? endOfDayIso }));

  const rows: IntervalBucket[] = buckets.map((bucket) => {
    let requiredHC = 0;
    for (const r of requirementRanges) {
      if (windowCoversInstant(r.scheduledStart, r.scheduledEnd, bucket.startIso)) requiredHC += r.requiredHC;
    }

    let scheduledHC = 0;
    for (const r of scheduleRanges) {
      if (windowCoversInstant(r.scheduledStart, r.scheduledEnd, bucket.startIso)) scheduledHC += 1;
    }

    const presentEmployees = new Set<string>();
    for (const r of attendanceRanges) {
      if (windowCoversInstant(r.start, r.end, bucket.startIso)) presentEmployees.add(r.employeeId);
    }
    const onBreak = new Set<string>();
    for (const r of breakRanges) {
      if (windowCoversInstant(r.start, r.end, bucket.startIso)) onBreak.add(r.employeeId);
    }
    const availableHC = [...presentEmployees].filter((id) => !onBreak.has(id)).length;

    return {
      intervalStart: bucket.startIso,
      label: bucket.label,
      requiredHC,
      scheduledHC,
      presentHC: presentEmployees.size,
      availableHC,
      staffingGap: scheduledHC - requiredHC,
      availableStaffingGap: availableHC - requiredHC,
      offeredCalls: 0,
      answeredCalls: 0,
      abandonedCalls: 0,
      ahtSeconds: null,
      serviceLevelPct: null,
      occupancyPct: null,
    };
  });

  // Raw counts first (offered/answered/abandoned/handle-seconds-sum/within-threshold), then the
  // ratio fields once every bucket's totals are final - same "sum raw counts first, then compute
  // the ratio once" discipline as callMetrics.service.ts. Each call is a single point in time
  // (its own IntervalStart - migration 0011's call-detail model), so it lands in exactly one
  // bucket, never split or fabricated into a bucket it doesn't fall in.
  const handleSecondsSum = new Map<number, number>();
  const withinThresholdCount = new Map<number, number>();
  for (const call of callEvents) {
    const idx = bucketIndexForInstant(call.intervalStart, buckets, endOfDayIso);
    if (idx === null) continue; // outside this business date's own window - a data anomaly, not silently reassigned to the nearest bucket
    const row = rows[idx]!;
    row.offeredCalls += 1;
    if (call.answered) {
      row.answeredCalls += 1;
      handleSecondsSum.set(idx, (handleSecondsSum.get(idx) ?? 0) + call.handleSeconds);
    }
    if (call.abandoned) row.abandonedCalls += 1;
    if (call.answeredWithinThreshold) withinThresholdCount.set(idx, (withinThresholdCount.get(idx) ?? 0) + 1);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const handleSum = handleSecondsSum.get(i) ?? 0;
    row.ahtSeconds = row.answeredCalls > 0 ? round2(handleSum / row.answeredCalls) : null;
    row.serviceLevelPct = row.offeredCalls > 0 ? round2(((withinThresholdCount.get(i) ?? 0) / row.offeredCalls) * 100) : null;
    // Unlike the day-grain Occupancy in staffing.service.ts (which must assume a configurable
    // standard shift length because it has no real per-agent logged hours to divide by), an
    // interval bucket's own width *is* the real available time for anyone present in it - so the
    // denominator here is bucketHours, not standardShiftHours.
    const workloadHours = (row.offeredCalls * (row.ahtSeconds ?? 0)) / 3600;
    row.occupancyPct = row.presentHC > 0 ? round2((workloadHours / (row.presentHC * bucketHours)) * 100) : null;
  }

  const entityType = params.processId ? "ProcessInterval" : "CompanyInterval";
  const entityIdPrefix = params.processId ? String(params.processId) : "ALL";
  await Promise.all(
    rows.flatMap((row) => {
      const entityId = `${entityIdPrefix}|${row.intervalStart}`;
      const inputsSnapshot = { requiredHC: row.requiredHC, scheduledHC: row.scheduledHC, presentHC: row.presentHC, availableHC: row.availableHC, offeredCalls: row.offeredCalls, answeredCalls: row.answeredCalls };
      const writes: Promise<void>[] = [
        recordCalculation({ formulaCode: "STAFFING_GAP", formulaVersion: 1, entityType, entityId, businessDate: params.businessDate, computedValue: row.staffingGap, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }),
        recordCalculation({ formulaCode: "AVAILABLE_STAFFING_GAP", formulaVersion: 1, entityType, entityId, businessDate: params.businessDate, computedValue: row.availableStaffingGap, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }),
      ];
      if (row.ahtSeconds !== null) writes.push(recordCalculation({ formulaCode: "AHT_SECONDS", formulaVersion: 1, entityType, entityId, businessDate: params.businessDate, computedValue: row.ahtSeconds, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }));
      if (row.serviceLevelPct !== null) writes.push(recordCalculation({ formulaCode: "SERVICE_LEVEL_PCT", formulaVersion: 1, entityType, entityId, businessDate: params.businessDate, computedValue: row.serviceLevelPct, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }));
      if (row.occupancyPct !== null) writes.push(recordCalculation({ formulaCode: "OCCUPANCY_PCT", formulaVersion: 1, entityType, entityId, businessDate: params.businessDate, computedValue: row.occupancyPct, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }));
      return writes;
    }),
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Break Management
// ---------------------------------------------------------------------------

export async function startBreak(input: { employeeId: string; businessDate: string; breakStart: string; createdByUserId: string }): Promise<number> {
  const id = await repo.createBreakSession(input);
  await recordAudit({
    entityType: "BreakSession",
    entityId: String(id),
    action: "CREATE",
    performedByUserId: input.createdByUserId,
    after: input,
  });
  return id;
}

export async function endBreak(id: number, breakEnd: string, performedByUserId: string): Promise<void> {
  const before = await repo.getBreakSession(id);
  if (!before) throw new NotFoundError("Break session not found.");
  if (before.breakEnd) throw new ValidationError("This break has already ended.");
  if (new Date(breakEnd).getTime() <= new Date(before.breakStart).getTime()) throw new ValidationError("breakEnd must be after breakStart.");

  await repo.endBreakSession(id, breakEnd);
  await recordAudit({
    entityType: "BreakSession",
    entityId: String(id),
    action: "ADJUST",
    performedByUserId,
    before,
    after: { ...before, breakEnd },
  });
}

export async function listBreaks(params: { businessDate: string; processId?: number }): Promise<repo.BreakSessionRow[]> {
  return repo.listBreakSessionsForDate(params);
}

// ---------------------------------------------------------------------------
// Exception engine
// ---------------------------------------------------------------------------

function breachesThreshold(value: number, operator: repo.ComparisonOperator, threshold: number): boolean {
  switch (operator) {
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
  }
}

/**
 * Runs every active ExceptionRule against real, already-computed data for one business date
 * (build spec section 20's "configurable-threshold exception engine across staffing, service
 * level, attendance and data quality") and records a new intraday.Exception for each real
 * breach not already open. On demand only (no cron - see documentation/troubleshooting.md), so
 * it is safe (and expected) to call this repeatedly; ensureException's dedup means a repeat
 * scan over unchanged data creates nothing new.
 *
 * Each rule category evaluates at its own natural grain rather than being forced onto one
 * shape: STAFFING/SERVICE_LEVEL reuse getIntervalSummary per real process (interval-grain);
 * ATTENDANCE reuses attendance.service's own daily summaries (day-grain, per employee);
 * DATA_QUALITY ignores businessDate/processId entirely, since an import run isn't naturally
 * "on" whatever date a scan happens to be viewing (see listHighSeverityDataQualityBreaches).
 */
export async function scanForExceptions(params: { businessDate: string; processId?: number; computedByUserId?: string }): Promise<{ newExceptionCount: number }> {
  const rules = await repo.listActiveExceptionRules();
  const rulesByCategory = new Map<string, repo.ExceptionRuleRow[]>();
  for (const rule of rules) {
    const list = rulesByCategory.get(rule.category);
    if (list) list.push(rule);
    else rulesByCategory.set(rule.category, [rule]);
  }

  let newExceptionCount = 0;
  async function record(input: Parameters<typeof repo.ensureException>[0]): Promise<void> {
    const id = await repo.ensureException(input);
    if (id !== null) newExceptionCount += 1;
  }

  const staffingRules = rulesByCategory.get("STAFFING") ?? [];
  const serviceLevelRules = rulesByCategory.get("SERVICE_LEVEL") ?? [];
  if (staffingRules.length > 0 || serviceLevelRules.length > 0) {
    const processes = params.processId ? [{ id: params.processId }] : await listProcesses();
    for (const proc of processes) {
      const buckets = await getIntervalSummary({ businessDate: params.businessDate, processId: proc.id, computedByUserId: params.computedByUserId });
      for (const bucket of buckets) {
        for (const rule of staffingRules) {
          if (breachesThreshold(bucket.staffingGap, rule.comparisonOperator, rule.thresholdValue)) {
            await record({ exceptionRuleId: rule.exceptionRuleId, entityType: "Process", entityId: String(proc.id), businessDate: params.businessDate, intervalStart: bucket.intervalStart, observedValue: bucket.staffingGap, thresholdValue: rule.thresholdValue });
          }
        }
        if (bucket.serviceLevelPct !== null) {
          for (const rule of serviceLevelRules) {
            if (breachesThreshold(bucket.serviceLevelPct, rule.comparisonOperator, rule.thresholdValue)) {
              await record({ exceptionRuleId: rule.exceptionRuleId, entityType: "Process", entityId: String(proc.id), businessDate: params.businessDate, intervalStart: bucket.intervalStart, observedValue: bucket.serviceLevelPct, thresholdValue: rule.thresholdValue });
            }
          }
        }
      }
    }
  }

  const attendanceRules = rulesByCategory.get("ATTENDANCE") ?? [];
  if (attendanceRules.length > 0) {
    const tz = getConfigString("business_day.timezone", "Asia/Kolkata");
    const midnightIso = combineLocalDateTime(params.businessDate, "00:00", tz);
    const summaries = await listDailySummaries({ from: params.businessDate, to: params.businessDate, page: 1, pageSize: 1000 });
    const allowedEmployeeIds = params.processId
      ? new Set((await repo.listScheduledEmployeeWindows({ businessDate: params.businessDate, processId: params.processId })).map((w) => w.employeeId))
      : null;
    for (const day of summaries.items) {
      if (allowedEmployeeIds && !allowedEmployeeIds.has(day.employeeId)) continue;
      if (day.lateMinutes === null) continue;
      for (const rule of attendanceRules) {
        if (breachesThreshold(day.lateMinutes, rule.comparisonOperator, rule.thresholdValue)) {
          await record({ exceptionRuleId: rule.exceptionRuleId, entityType: "Employee", entityId: day.employeeId, businessDate: params.businessDate, intervalStart: midnightIso, observedValue: day.lateMinutes, thresholdValue: rule.thresholdValue });
        }
      }
    }
  }

  const dataQualityRules = rulesByCategory.get("DATA_QUALITY") ?? [];
  for (const rule of dataQualityRules) {
    const breaches = await repo.listHighSeverityDataQualityBreaches(rule.thresholdValue);
    for (const breach of breaches) {
      const tz = getConfigString("business_day.timezone", "Asia/Kolkata");
      const midnightIso = combineLocalDateTime(breach.businessDate, "00:00", tz);
      await record({ exceptionRuleId: rule.exceptionRuleId, entityType: "ImportRun", entityId: String(breach.importRunId), businessDate: breach.businessDate, intervalStart: midnightIso, observedValue: breach.highSeverityOpenCount, thresholdValue: rule.thresholdValue });
    }
  }

  return { newExceptionCount };
}

export async function listExceptions(params: { status?: string; excludeResolved?: boolean; category?: string; from?: string; to?: string }): Promise<repo.ExceptionListRow[]> {
  return repo.listExceptions(params);
}

async function requireExceptionInStatus(id: number, expected: repo.ExceptionListRow["status"]): Promise<void> {
  const current = await repo.getExceptionStatus(id);
  if (!current) throw new NotFoundError("Exception not found.");
  if (current.status !== expected) throw new ValidationError(`This exception is "${current.status}", not "${expected}" - it may have already been actioned by someone else.`);
}

export async function acknowledgeException(id: number, userId: string): Promise<void> {
  await requireExceptionInStatus(id, "DETECTED");
  await repo.acknowledgeException(id, userId);
  await recordAudit({ entityType: "Exception", entityId: String(id), action: "ADJUST", performedByUserId: userId, after: { status: "ACKNOWLEDGED" } });
}

export async function recordExceptionAction(id: number, actionTaken: string, userId: string): Promise<void> {
  await requireExceptionInStatus(id, "ACKNOWLEDGED");
  await repo.recordExceptionAction(id, actionTaken, userId);
  await recordAudit({ entityType: "Exception", entityId: String(id), action: "ADJUST", performedByUserId: userId, after: { status: "ACTION_TAKEN", actionTaken } });
}

export async function resolveException(id: number, resolutionNotes: string | null, userId: string): Promise<void> {
  await requireExceptionInStatus(id, "ACTION_TAKEN");
  await repo.resolveException(id, resolutionNotes, userId);
  await recordAudit({ entityType: "Exception", entityId: String(id), action: "ADJUST", performedByUserId: userId, after: { status: "RESOLVED", resolutionNotes } });
}

// ---------------------------------------------------------------------------
// OT/VTO (Overtime, early release and VTO requests - "early release" is a VTO request for part
// of a shift, not a third RequestType: see migration 0012_intraday.sql's header comment)
// ---------------------------------------------------------------------------

export async function createCapacityRequest(input: {
  requestType: repo.CapacityRequestType;
  employeeId?: string;
  businessDate: string;
  hoursRequested: number;
  reason: string | null;
  requestedByUserId: string;
  canActForOthers: boolean;
}): Promise<number> {
  let employeeId = input.employeeId;
  if (!input.canActForOthers) {
    const ownEmployeeId = await repo.getEmployeeIdForUser(input.requestedByUserId);
    if (!ownEmployeeId) throw new ValidationError("Your account is not linked to an employee record, so you cannot submit a request for yourself. Ask an administrator to link your account to an employee.");
    employeeId = ownEmployeeId;
  } else if (!employeeId) {
    throw new ValidationError("employeeId is required.");
  }

  const id = await repo.createCapacityRequest({ requestType: input.requestType, employeeId, businessDate: input.businessDate, hoursRequested: input.hoursRequested, reason: input.reason, requestedByUserId: input.requestedByUserId });
  await recordAudit({
    entityType: "CapacityAdjustmentRequest",
    entityId: String(id),
    action: "CREATE",
    performedByUserId: input.requestedByUserId,
    after: { requestType: input.requestType, employeeId, businessDate: input.businessDate, hoursRequested: input.hoursRequested, reason: input.reason },
  });
  return id;
}

export async function listCapacityRequests(params: { businessDate?: string; status?: string; employeeId?: string }): Promise<repo.CapacityRequestRow[]> {
  return repo.listCapacityRequests(params);
}

export async function decideCapacityRequest(id: number, decision: "APPROVED" | "REJECTED", decisionNotes: string | null, userId: string): Promise<void> {
  const before = await repo.getCapacityRequest(id);
  if (!before) throw new NotFoundError("Request not found.");
  if (before.status !== "REQUESTED") throw new ValidationError(`This request is already "${before.status}".`);

  await repo.decideCapacityRequest(id, decision, decisionNotes, userId);
  await recordAudit({ entityType: "CapacityAdjustmentRequest", entityId: String(id), action: "ADJUST", performedByUserId: userId, before, after: { ...before, status: decision, decisionNotes } });
}

export async function cancelCapacityRequest(id: number, userId: string, canActForOthers: boolean): Promise<void> {
  const before = await repo.getCapacityRequest(id);
  if (!before) throw new NotFoundError("Request not found.");
  if (before.status !== "REQUESTED") throw new ValidationError(`This request is already "${before.status}" and can no longer be cancelled.`);
  if (before.requestedByUserId !== userId && !canActForOthers) throw new ForbiddenError("You can only cancel your own requests.");

  await repo.cancelCapacityRequest(id, userId);
  await recordAudit({ entityType: "CapacityAdjustmentRequest", entityId: String(id), action: "ADJUST", performedByUserId: userId, before, after: { ...before, status: "CANCELLED" }, reason: "Cancelled by requester" });
}

export interface CapacityImpactBucket {
  intervalStart: string;
  label: string;
  beforeStaffingGap: number;
  afterStaffingGap: number;
}

/**
 * A real, single-employee before/after preview - deliberately NOT a general simulator (that is
 * Phase 10's Scenario Planning, which explicitly "never touches live data"). This reuses
 * getIntervalSummary's real, current numbers for "before" (and ledger-logs them exactly as any
 * other read of that engine would); "after" is a plain +/-1 HC delta applied in memory only to
 * the specific buckets this one employee's requested hours would add (OVERTIME) or remove
 * (VTO/early release) - never written anywhere, since it is hypothetical until approved.
 */
export async function getCapacityImpact(params: { employeeId: string; businessDate: string; requestType: repo.CapacityRequestType; hoursRequested: number; computedByUserId?: string }): Promise<CapacityImpactBucket[]> {
  const tz = getConfigString("business_day.timezone", "Asia/Kolkata");
  const window = await repo.getScheduledWindowForEmployee(params.employeeId, params.businessDate);
  if (!window) throw new ValidationError("This employee has no published schedule on this business date.");

  const scheduled = computeScheduledWindow({ businessDate: params.businessDate, shiftId: window.shiftId, startTime: window.startTime, endTime: window.endTime, isOvernight: window.isOvernight, isWeeklyOff: window.isWeeklyOff }, tz);
  if (!scheduled.scheduledStart || !scheduled.scheduledEnd) throw new ValidationError("This employee has no working shift on this business date (weekly off, or no shift on their published assignment).");

  const deltaMs = params.hoursRequested * 3_600_000;
  const originalEndMs = new Date(scheduled.scheduledEnd).getTime();
  const newEndMs = params.requestType === "VTO" ? originalEndMs - deltaMs : originalEndMs + deltaMs;
  const rangeStartMs = params.requestType === "VTO" ? Math.min(newEndMs, originalEndMs) : originalEndMs;
  const rangeEndMs = params.requestType === "VTO" ? originalEndMs : Math.max(newEndMs, originalEndMs);
  const delta = params.requestType === "VTO" ? -1 : 1;

  const buckets = await getIntervalSummary({ businessDate: params.businessDate, processId: window.processId ?? undefined, computedByUserId: params.computedByUserId });
  return buckets
    .filter((b) => {
      const t = new Date(b.intervalStart).getTime();
      return t >= rangeStartMs && t < rangeEndMs;
    })
    .map((b) => ({ intervalStart: b.intervalStart, label: b.label, beforeStaffingGap: b.staffingGap, afterStaffingGap: b.staffingGap + delta }));
}
