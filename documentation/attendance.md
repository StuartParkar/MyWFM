# Attendance & the Business Day Engine

## The Business Day Engine (build spec section 9)

The problem it solves: an overnight shift (5PM-2AM) must not have its attendance split across
two calendar dates just because the clock crossed midnight. The worked example from the build
spec, which `shared/tests/businessDate.test.ts` asserts directly:

```text
Shift:          5:00 PM -> 2:00 AM
Business Date:  25-Sep-2026
Login:          25-Sep-2026 17:00  -> stays on business date 25-Sep-2026
Logout:         26-Sep-2026 02:00  -> ALSO business date 25-Sep-2026 (not the 26th)
```

`shared/src/businessDate.ts` has three functions, all pure and dependency-free (timezone
conversion uses `Intl.DateTimeFormat`, never an external date library):

- **`resolveBusinessDate(instantIso, timezone, { endTime, isOvernight })`** - given a punch
  instant and the shift it was punched against, returns the business date. Rule: if the shift
  is overnight and the punch's local time is at-or-before the shift's EndTime, it's the tail of
  the *previous* calendar day's window, so the date rolls back one day. A non-overnight shift
  never adjusts - an out-of-window stray punch is safest left on its own calendar date rather
  than guessed at.
- **`resolveGlobalBusinessDate(instantIso, timezone, dayStartTime)`** - the company-wide "what
  business date is it right now", independent of any specific employee's shift (what the
  Global Filter Bar's date presets are relative to, and what
  `GET /api/business-day/today` returns). `dayStartTime` is the
  `business_day.start_time` configuration setting; with the seeded default of `"00:00"` this is
  identical to the plain calendar date. This is a *different* comparison than
  `resolveBusinessDate` (exclusive of the cutoff instant, not inclusive) - see the doc comment
  on why they aren't the same rule wearing different config.
- **`combineLocalDateTime(isoDate, hhmm, timezone)`** - the reverse conversion: a shift's
  StartTime/EndTime on a given business date, combined into the UTC instant it represents, so
  it can be compared against a stored attendance timestamp. Uses the standard guess-and-correct
  approach for arbitrary IANA zones (no timezone database is bundled).

Configuration (`config.ConfigurationSetting`, category `BUSINESS_DAY`): `business_day.timezone`
(default `"Asia/Kolkata"`) and `business_day.start_time` (default `"00:00"`).

## Attendance sessions (build spec section 14)

`attendance.AttendanceSession` (migration `0008_attendance.sql`) is deliberately a session
table, not a single first-login/last-logout pair per employee/day: multiple sessions on one
business date are how a "double shift" is represented, and First Login/Last Logout/Net Working
Hours are all *derived* from the session set on every read (`attendance.service.ts`), never
stored - so a later grace-period or minimum-gap config change applies retroactively without a
backfill. Every session records `Source` (`MANUAL` / `IMPORT` / `ADJUSTMENT`) - see "What's not
built yet" below for why only `MANUAL` exists today.

### Formulas (build spec section 15)

Computed per (employee, business date), from that day's sessions plus the active
`roster.PublishedRoster` row (for Scheduled Start/End) and three config values:

| Setting | Default | Used for |
|---|---|---|
| `attendance.late_grace_minutes` | 5 | Late Minutes |
| `attendance.early_logout_grace_minutes` | 5 | Early Logout Minutes |
| `attendance.double_shift_min_gap_hours` | 5 | Double Shift Exception |

- **Gross Login Hours** = Last Logout - First Login (across the whole day; `null` if no session
  has closed yet).
- **Net Working Hours** = sum of each closed session's (End - Start - BreakMinutes), so a gap
  *between* sessions is never counted as worked time.
- **Variance** = Net Working Hours - Scheduled Hours (`null` if either side is unknown - a
  weekly-off day has Scheduled Hours = 0, not null, so working on a day off still produces a
  real positive variance).
- **Late Minutes** / **Early Logout Minutes** = the raw difference against Scheduled
  Start/End; at-or-under the grace period reports `0` (not late/early), over it reports the
  full raw minutes (not the raw minutes minus grace - the grace period is a forgiveness
  threshold, not a deduction).
- **Double Shift Exception** = `true` if any two sessions the same day have a gap (previous
  session's end to next session's start) under the configured minimum. A still-open previous
  session (no end yet) is skipped rather than treated as a zero-length gap.
- **Status** is `PRESENT` (at least one session, open or closed), `ABSENT` (a schedule exists,
  zero sessions), or `ON_WEEKLY_OFF` (the roster marks the day as a weekly off, zero sessions).
  There is no separate "no schedule" status: a (employee, date) pair only appears at all
  because it came from a scheduled day or a session day (or both, per
  `attendance.repository.ts`'s `listScheduleAndSessionDays`), so zero sessions always implies a
  schedule exists. Attendance recorded on a date with no matching schedule is still `PRESENT`;
  it's visible as `scheduledHours: null` rather than a fabricated comparison.

## Manual entry, not import (for now)

Section 14 names three attendance sources: import, manual entry, and authorized adjustment.
Unlike Calls (section 76 - explicitly blocked on real phone-system files), nothing blocks an
attendance *import* on principle - there's just no real source system named or provided yet
(no biometric device export, no PBX login log). Building an importer for a format nobody has
specified would be inventing the same kind of fabricated mapping the project avoids elsewhere,
so today every session is `MANUAL` (typed in by a WFM user, per the Operations > Attendance
screen) or `ADJUSTMENT` (an edit to an existing session - both require a reason,
per section 14's "every manual adjustment must store... reason").

A manual entry names its own Business Date explicitly (the same convention as a roster
requirement's submission form), rather than the backend auto-classifying it from the punch
timestamp - the person entering it already knows which business date they mean. The service
still uses the Business Day Engine as a sanity check: a `sessionStart` whose own local calendar
date is more than a day away from the stated `businessDate` is rejected as implausible, catching
a typo without silently overriding what the person typed.

## Screens

| Screen | Path | Permission | What it does |
|---|---|---|---|
| Attendance | `/operations/attendance` | `attendance.view` to see, `attendance.manage` to record/adjust/remove | Daily summaries for a date range (+ optional employee filter), a manual-entry form, and per-day session management (adjust/remove, each requiring a reason) |

`GET /api/business-day/today` (bearer-only, no extra permission) is what
`frontend/src/lib/filters/FilterContext.tsx` calls to replace its Phase 1 placeholder
business-date with the real, config-driven one - see that file's comments for why it's cached
in a ref rather than component state.

## What's not built yet

- No attendance **import** pipeline (see above - no real source file exists to build one
  against).
- Live/intraday break coverage monitoring (currently-on-break agents vs. required HC) is a
  different concern from historical `BreakMinutes` bookkeeping here - it's Phase 9's Break
  Management, which needs the Intraday module's real-time state, not this phase's.
- The unified `/roster/calendar` view (attendance alongside roster, holidays, forecast, etc.
  in one calendar) is Phase 8, per `navTree.ts`.
