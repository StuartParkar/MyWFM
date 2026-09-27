import type { PaginatedResult } from "@mywfm/shared";
import { addDays, combineLocalDateTime, toLocalCalendarDate } from "@mywfm/shared";
import { getConfigNumber, getConfigString } from "../../config/appConfig.js";
import { NotFoundError, ValidationError } from "../../errors/AppError.js";
import { recordAudit } from "../audit/audit.service.js";
import * as repo from "./attendance.repository.js";

function timezone(): string {
  return getConfigString("business_day.timezone", "Asia/Kolkata");
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Manual entry still names an explicit business date (same convention as a roster
 * requirement) rather than trying to auto-classify it - see documentation/attendance.md for
 * why. This only guards against a wildly mismatched pairing (the wrong century, a typo'd
 * month), using the Business Day Engine's own timezone conversion as the sanity check.
 */
function assertBusinessDateIsPlausible(sessionStartIso: string, businessDate: string): void {
  const localDate = toLocalCalendarDate(sessionStartIso, timezone());
  if (Math.abs(daysBetween(localDate, businessDate)) > 1) {
    throw new ValidationError(
      `businessDate (${businessDate}) is implausibly far from sessionStart's local date (${localDate}). Check both values.`,
    );
  }
}

export async function recordSession(input: {
  employeeId: string;
  businessDate: string;
  sessionStart: string;
  sessionEnd?: string | null;
  breakMinutes?: number;
  reason?: string | null;
  recordedByUserId: string;
}): Promise<number> {
  assertBusinessDateIsPlausible(input.sessionStart, input.businessDate);
  if (input.sessionEnd) assertBusinessDateIsPlausible(input.sessionEnd, input.businessDate);

  const id = await repo.createSession({ ...input, source: "MANUAL" });
  await recordAudit({
    entityType: "AttendanceSession",
    entityId: String(id),
    action: "CREATE",
    performedByUserId: input.recordedByUserId,
    after: input,
    reason: input.reason ?? undefined,
  });
  return id;
}

export async function adjustSession(
  id: number,
  patch: { sessionStart?: string; sessionEnd?: string | null; breakMinutes?: number },
  reason: string,
  performedByUserId: string,
): Promise<void> {
  const before = await repo.getSession(id);
  if (!before) throw new NotFoundError("Attendance session not found.");

  const nextBusinessDate = before.businessDate;
  if (patch.sessionStart) assertBusinessDateIsPlausible(patch.sessionStart, nextBusinessDate);
  if (patch.sessionEnd) assertBusinessDateIsPlausible(patch.sessionEnd, nextBusinessDate);

  await repo.updateSession(id, patch);
  await recordAudit({
    entityType: "AttendanceSession",
    entityId: String(id),
    action: "ADJUST",
    performedByUserId,
    before,
    after: { ...before, ...patch },
    reason,
  });
}

export async function removeSession(id: number, reason: string, performedByUserId: string): Promise<void> {
  const before = await repo.getSession(id);
  if (!before) throw new NotFoundError("Attendance session not found.");

  await repo.deleteSession(id);
  await recordAudit({
    entityType: "AttendanceSession",
    entityId: String(id),
    action: "DELETE",
    performedByUserId,
    before,
    reason,
  });
}

export interface DailyAttendanceSummary {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  businessDate: string;
  shiftCode: string | null;
  isWeeklyOff: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduledHours: number | null;
  firstLogin: string | null;
  lastLogout: string | null;
  grossLoginHours: number | null;
  netWorkingHours: number | null;
  varianceHours: number | null;
  lateMinutes: number | null;
  earlyLogoutMinutes: number | null;
  doubleShiftException: boolean;
  sessionCount: number;
  status: "PRESENT" | "ABSENT" | "ON_WEEKLY_OFF";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toHours(ms: number): number {
  return round2(ms / 3_600_000);
}

export interface ScheduledWindow {
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduledHours: number | null;
}

/**
 * An employee's scheduled window for one business date, from their active published-roster
 * assignment - shared with shrinkage.service.ts (Shrinkage % needs the same Scheduled Hours
 * this module's own Variance formula does), so the overnight-aware date math
 * (combineLocalDateTime + the IsOvernight day-rollover) lives in exactly one place.
 */
export function computeScheduledWindow(
  key: { businessDate: string; shiftId: number | null; startTime: string | null; endTime: string | null; isOvernight: boolean | null; isWeeklyOff: boolean },
  tz: string,
): ScheduledWindow {
  if (key.isWeeklyOff) return { scheduledStart: null, scheduledEnd: null, scheduledHours: 0 };
  if (!key.shiftId || !key.startTime || !key.endTime) return { scheduledStart: null, scheduledEnd: null, scheduledHours: null };

  const scheduledStart = combineLocalDateTime(key.businessDate, key.startTime, tz);
  const endDate = key.isOvernight ? addDays(key.businessDate, 1) : key.businessDate;
  const scheduledEnd = combineLocalDateTime(endDate, key.endTime, tz);
  return { scheduledStart, scheduledEnd, scheduledHours: toHours(new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()) };
}

/** Build spec section 15's formulas, computed per (employee, business date) from the raw session set - never stored, always derived so a config change (grace period, min gap) applies retroactively rather than needing a backfill. */
function summarizeDay(key: repo.ScheduleKeyRow, allSessions: repo.AttendanceSessionRow[], config: { tz: string; lateGraceMinutes: number; earlyGraceMinutes: number; minGapHours: number }): DailyAttendanceSummary {
  const sorted = [...allSessions].sort((a, b) => a.sessionStart.localeCompare(b.sessionStart));
  const closed = sorted.filter((s) => s.sessionEnd !== null);

  const firstLogin = sorted[0]?.sessionStart ?? null;
  const lastLogout = closed.length > 0 ? closed[closed.length - 1]!.sessionEnd : null;
  const grossLoginHours = firstLogin && lastLogout ? toHours(new Date(lastLogout).getTime() - new Date(firstLogin).getTime()) : null;
  const netWorkingHours =
    closed.length > 0
      ? toHours(closed.reduce((sum, s) => sum + (new Date(s.sessionEnd!).getTime() - new Date(s.sessionStart).getTime() - s.breakMinutes * 60_000), 0))
      : null;

  let doubleShiftException = false;
  for (let i = 1; i < sorted.length; i++) {
    const previousEnd = sorted[i - 1]!.sessionEnd;
    if (!previousEnd) continue; // the previous session is still open - no gap to assess yet
    const gapMs = new Date(sorted[i]!.sessionStart).getTime() - new Date(previousEnd).getTime();
    if (gapMs < config.minGapHours * 3_600_000) doubleShiftException = true;
  }

  const { scheduledStart, scheduledEnd, scheduledHours } = computeScheduledWindow(key, config.tz);

  const varianceHours = netWorkingHours !== null && scheduledHours !== null ? round2(netWorkingHours - scheduledHours) : null;

  let lateMinutes: number | null = null;
  if (firstLogin && scheduledStart) {
    const rawLateMinutes = Math.round((new Date(firstLogin).getTime() - new Date(scheduledStart).getTime()) / 60_000);
    lateMinutes = rawLateMinutes > config.lateGraceMinutes ? rawLateMinutes : 0;
  }

  let earlyLogoutMinutes: number | null = null;
  if (lastLogout && scheduledEnd) {
    const rawEarlyMinutes = Math.round((new Date(scheduledEnd).getTime() - new Date(lastLogout).getTime()) / 60_000);
    earlyLogoutMinutes = rawEarlyMinutes > config.earlyGraceMinutes ? rawEarlyMinutes : 0;
  }

  // A key only exists here because it came from a scheduled day or a session day (or both) -
  // zero sessions therefore always means the key came from a schedule, so "ABSENT" and
  // "ON_WEEKLY_OFF" are the only zero-session outcomes; there is no reachable "no schedule and
  // no attendance" case to represent. Presence with no comparable schedule (attendance
  // recorded on an unscheduled date) is still visible - scheduledHours is simply null - rather
  // than needing its own status value.
  const status: DailyAttendanceSummary["status"] = sorted.length > 0 ? "PRESENT" : key.isWeeklyOff ? "ON_WEEKLY_OFF" : "ABSENT";

  return {
    employeeId: key.employeeId,
    employeeCode: key.employeeCode,
    employeeName: key.employeeName,
    businessDate: key.businessDate,
    shiftCode: key.shiftCode,
    isWeeklyOff: key.isWeeklyOff,
    scheduledStart,
    scheduledEnd,
    scheduledHours,
    firstLogin,
    lastLogout,
    grossLoginHours,
    netWorkingHours,
    varianceHours,
    lateMinutes,
    earlyLogoutMinutes,
    doubleShiftException,
    sessionCount: sorted.length,
    status,
  };
}

export async function listDailySummaries(params: {
  employeeId?: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<DailyAttendanceSummary>> {
  const config = {
    tz: timezone(),
    lateGraceMinutes: getConfigNumber("attendance.late_grace_minutes", 5),
    earlyGraceMinutes: getConfigNumber("attendance.early_logout_grace_minutes", 5),
    minGapHours: getConfigNumber("attendance.double_shift_min_gap_hours", 5),
  };

  const keys = await repo.listScheduleAndSessionDays(params);
  const sessions = await repo.listSessionsForKeys(
    keys.items.map((key) => ({ employeeId: key.employeeId, businessDate: key.businessDate })),
  );

  const sessionsByKey = new Map<string, repo.AttendanceSessionRow[]>();
  for (const s of sessions) {
    const mapKey = `${s.employeeId}|${s.businessDate}`;
    const list = sessionsByKey.get(mapKey);
    if (list) list.push(s);
    else sessionsByKey.set(mapKey, [s]);
  }

  return {
    ...keys,
    items: keys.items.map((key) => summarizeDay(key, sessionsByKey.get(`${key.employeeId}|${key.businessDate}`) ?? [], config)),
  };
}
