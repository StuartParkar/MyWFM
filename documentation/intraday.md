# Intraday (Phase 9)

Interval-level staffing/service visibility for one business date at a time,
a configurable-threshold exception engine across four categories, break
tracking, and an Overtime/VTO request workflow with a real before/after
capacity preview (build spec section 20).

No new schema was needed for interval-level HC/calls math at all - it is
computed on read from `master.Shift`/`roster.PublishedRoster`/
`attendance.AttendanceSession`/`attendance.BreakSession`/
`calls.QueueIntervalCall` rows already recorded by earlier phases. Three
genuinely new tables exist (migration `0012_intraday.sql`):

| Table | Purpose |
|---|---|
| `intraday.ExceptionRule` | Configurable-threshold rule catalog (seeded in `0005_exception_rules.sql`) |
| `intraday.Exception` | One row per detected breach, with its own detected -> acknowledged -> action taken -> resolved lifecycle |
| `intraday.CapacityAdjustmentRequest` | Overtime and VTO share one table (a signed-hours request against a business date), not two near-identical ones |
| `attendance.BreakSession` | Real break start/end tracking - `AttendanceSession.BreakMinutes` is an aggregate, not granular times |

## Interval-bucketing engine (Intraday Control)

`GET /api/intraday/interval-summary?businessDate=&processId=`
(`intraday.service.ts`'s `getIntervalSummary`) buckets exactly one business
date into `intraday.interval_minutes`-wide intervals (seeded default: 30 -
`database/seed-data/0002_default_configuration.sql`) and computes, per
bucket: Required/Scheduled/Present/Available HC, Staffing Gap, Available
Staffing Gap, Offered/Answered/Abandoned Calls, AHT, Service Level % and
Occupancy %.

**Sampling convention.** An entity (a requirement's headcount, a scheduled
employee, a present employee) counts toward a bucket when its real window
`[start, end)` contains the bucket's own *start* instant - "headcount as of
the top of the interval," the standard call-center WFM convention, not a
fractional-overlap split. A call is a single point in time (its own
`IntervalStart` - migration `0011`'s call-detail model), so it lands in
exactly one bucket, whichever one's `[start, end)` contains it.

**Overnight shifts extend the bucket range.** Buckets normally span
businessDate's own calendar 00:00-24:00, but a shift like 22:00-02:00 is
entirely owned by the *earlier* business date (the Business Day Engine's own
`resolveBusinessDate` rule - see `documentation/attendance.md`) and genuinely
ends after calendar midnight. `getIntervalSummary` extends the bucket range
to the latest real `scheduledEnd` it finds among that date's requirements/
schedules before generating buckets, so that spillover is never silently
dropped from either day's view. A bucket past calendar midnight is labeled
e.g. `"01:30 (+1d)"` so it's unambiguous which calendar day it actually
falls on.

**A requirement or a call needs a resolvable window to appear at all.**
`roster.RosterRequirement.ShiftId` is genuinely optional at submission
(`roster.validation.ts`) - a requirement with no named shift has no interval
to place it in, so it's excluded from this specific interval-level
breakdown (it still counts in Staffing Coverage's and Control Tower's
day-grain totals, which don't need a shift window at all).

**Filter scope.** Process-filterable only, like Control Tower's Group A
(`documentation/controltower.md`) - a roster requirement and a call queue
aren't "for" one employee, so the HOD/TL/Agent-Senior/Designation cascade
has no well-defined meaning here either. Present/Available HC join the same
Process-only filter rather than getting their own cascade, because Intraday
Control is a single scope's timeline (one process, or company-wide), not a
multi-employee roster grid.

**Ledger.** Every derived ratio (Staffing Gap, Available Staffing Gap, AHT,
Service Level %, Occupancy %) gets a Calculation Ledger row per bucket, at
`entityType: "ProcessInterval"` / `"CompanyInterval"`,
`entityId: "<processId|ALL>|<bucket's ISO instant>"`. Raw counts (Required/
Scheduled/Present/Available HC, Calls) do not, matching the established
"raw counts aren't their own ledger entries" precedent
(`documentation/formulas.md`). This is a genuinely high write volume for a
single page load (up to ~48 buckets x 4 ratios) - an accepted cost, the same
one every other module's read-time ledger writes already accept, not a
special case.

## Break Management

`attendance.BreakSession` CRUD (`POST /api/intraday/breaks`,
`PATCH /api/intraday/breaks/:id/end`, `GET /api/intraday/breaks`), gated by
`intraday.manage` for writes - the same "an authorized user records this on
someone's behalf" model as `attendance.manage`, not agent self-service.
`GET /api/intraday/breaks/scheduled-employees?businessDate=&processId=`
lists who is eligible to have a break started (published, non-weekly-off).

The Break Management screen's "projected coverage" table is the interval
engine's own Required HC / Available HC / Available Staffing Gap columns,
reused as-is - a negative Available Staffing Gap is exactly the "coverage
exception" the nav description promises: Present HC minus whoever is
currently on a recorded break has fallen below Required HC.

## Exception engine

Four rule categories, each evaluating at its own natural grain rather than
being forced onto one shape:

| Rule (seeded) | Category | Grain | Entity |
|---|---|---|---|
| `STAFFING_GAP_BREACH` | STAFFING | Interval, per real process | `Process` |
| `SERVICE_LEVEL_BREACH` | SERVICE_LEVEL | Interval, per real process | `Process` |
| `ATTENDANCE_LATE` | ATTENDANCE | Day, per employee | `Employee` |
| `DATA_QUALITY_HIGH_SEVERITY` | DATA_QUALITY | Per import run | `ImportRun` |

`POST /api/intraday/exceptions/scan` (`intraday.manage`) runs every active
rule and records a new `intraday.Exception` for each real breach not
already open, via `ensureException` - a conditional insert guarded by the
same key (`ExceptionRuleId, EntityType, EntityId, BusinessDate,
IntervalStart`) the `UX_Exception_OpenDedup` filtered unique index (`WHERE
Status <> 'RESOLVED'`) enforces, so a repeat scan over unchanged data
creates nothing new. Detection runs **on demand only, never on a schedule**
(see `documentation/troubleshooting.md`) - there is no cron in this system.

STAFFING/SERVICE_LEVEL reuse `getIntervalSummary` per real process (`master.
Process`, or just the one requested); ATTENDANCE reuses
`attendance.service.ts`'s own daily summaries, restricted to a process's
scheduled employees only when a `processId` filter is given.
`ATTENDANCE_LATE` and `DATA_QUALITY_HIGH_SEVERITY` are whole-day exceptions,
so their `IntervalStart` is midnight of the relevant business date - never
`NULL`, by the same convention the migration's own dedup index depends on.

**DATA_QUALITY ignores the scan's own `businessDate` parameter entirely.**
An `import.ImportRun` isn't naturally "on" whatever date a scan happens to
be viewing - it evaluates every import run's currently-open HIGH-severity
issue count and uses *that run's own* `BusinessPeriodEnd` (falling back to
`BusinessPeriodStart`, then its upload date) as the exception's business
date. Only `Severity = 'HIGH'` counts toward this rule, exactly as seeded -
a `CRITICAL` issue is a distinct, more urgent severity this rule does not
also cover; that would be a separate rule for someone to add later via the
same `intraday.ExceptionRule` table, not something this rule silently
absorbs.

**Lifecycle.** `DETECTED -> ACKNOWLEDGED -> ACTION_TAKEN -> RESOLVED`,
strictly forward, one step at a time (`PATCH .../acknowledge`,
`.../action`, `.../resolve`, all `intraday.manage`) - attempting to skip a
step, or act on an already-resolved exception, is a `ValidationError`, not a
silent no-op. Every transition also writes to `audit.AuditLog` via
`recordAudit()`, the same general-purpose audit trail Break Management and
Attendance use - a dedicated action-log table (like Roster's
`RosterRequirementAction`) is reserved for genuinely multi-level review
chains, which this single-manage-permission workflow isn't.

**Screens.** Exceptions (`/intraday/exceptions`) is the browse/discovery
view plus the scan trigger; Actions (`/intraday/actions`) is the WFM work
queue, defaulting to everything still open (`excludeResolved: true`) with
inline Acknowledge/Record Action/Resolve controls. Both read the same `GET
/api/intraday/exceptions` listing (`status`, `excludeResolved`, `category`,
`from`, `to` - `status` and `excludeResolved` are mutually exclusive
filters, never combined). Reports > Exceptions (`/reports/exceptions`)
reuses the same endpoint for period-comparison volume/resolution-rate
reporting, the same pattern as every other Reports screen
(`documentation/reports.md`).

## Overtime / VTO

`intraday.CapacityAdjustmentRequest` covers **Overtime, early release and
VTO** with one `RequestType` (`OVERTIME` | `VTO`), not three: "early
release" is a VTO request for part of a shift (fewer hours than the full
remainder), not a materially different kind of record.

**Self-service vs. submitting for someone else.** `intraday.request` alone
(REQUESTOR, LEADER, WFM) can only submit for the caller's own linked
employee, resolved server-side from `security.[User].EmployeeId` (a link
that has existed, unused, since Phase 2's migration `0004` - this is the
first feature that needed it) - the request body's `employeeId` is ignored
entirely for such a caller, never trusted from client input. `intraday.
manage` (LEADER, WFM) may name any employee explicitly. Approve/reject
(`intraday.approve` - HOD, WFM) and cancel-your-own-still-pending-request
follow the same `REQUESTED -> {APPROVED | REJECTED | CANCELLED}` one-step
transition, guarded the same way the exception lifecycle is.

**Before/after capacity impact** (`GET /api/intraday/capacity-requests/
impact`) is a real, single-employee preview, not a general simulator - that
is deliberately Phase 10's Scenario Planning, which "never touches live
data." This reuses `getIntervalSummary`'s real, current Staffing Gap for
"before" (and ledger-logs it exactly as any other read of that engine
would); "after" is a plain +/-1 HC delta applied only in memory to the
specific buckets this one employee's requested hours would add (Overtime,
past their normal end) or remove (VTO, before their normal end) - never
written anywhere, since it is hypothetical until approved.

## Formula Library additions

| Code | Meaning |
|---|---|
| `AVAILABLE_STAFFING_GAP` | Available HC - Required HC (Available HC = Present HC minus who is on a recorded break) - distinct from `STAFFING_GAP` (vs. Scheduled HC) and `ACTUAL_STAFFING_GAP` (vs. Present HC, break-blind) |

`STAFFING_GAP`, `AHT_SECONDS`, `SERVICE_LEVEL_PCT` and `OCCUPANCY_PCT` are
reused at interval grain rather than duplicated under new codes - a formula
code names the calculation, not the grain it happens to run at (Control
Tower already reuses these same codes at company-date grain).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `intraday.interval_minutes` | 30 | Bucket width for Intraday Control and Break Management |

## Permissions

| Code | Grants |
|---|---|
| `intraday.view` | View Intraday Control, Break Management, Exceptions/Actions, OT/VTO (WFM, HOD, LEADER, REQUESTOR) |
| `intraday.manage` | Record/end breaks; scan for and action exceptions (WFM, LEADER) |
| `intraday.approve` | Approve/reject OT/VTO requests (WFM, HOD) |
| `intraday.request` | Submit an OT/VTO request for yourself (WFM, LEADER, REQUESTOR) |

## Screens

| Screen | Path | Permission |
|---|---|---|
| Intraday Control | `/intraday/control` | `intraday.view` |
| Break Management | `/intraday/breaks` | `intraday.view` (+`intraday.manage` to record/end a break) |
| Exceptions | `/intraday/exceptions` | `intraday.view` (+`intraday.manage` to scan) |
| Actions | `/intraday/actions` | `intraday.view` (+`intraday.manage` to act) |
| OT / VTO | `/intraday/ot-vto` | `intraday.view` (+`intraday.request`/`intraday.manage` to submit, `intraday.approve` to decide) |
| Reports > Exceptions | `/reports/exceptions` | Inherits `GET /api/intraday/exceptions`'s own `intraday.view` |

## What this phase does not cover

- No scheduled/background detection - scanning is always an explicit,
  on-demand action, consistent with this system having no cron anywhere.
- The Exceptions/Actions screens show a rule's *description*, not an
  editing UI for `intraday.ExceptionRule` itself - thresholds are seeded,
  real starting values (see `database/seed-data/0005_exception_rules.sql`),
  adjustable later by an Admin directly, the same deferred pattern several
  other config values already follow.
- `DATA_QUALITY_HIGH_SEVERITY` covers `Severity = 'HIGH'` only, exactly as
  seeded - `CRITICAL` issues are real but not yet covered by any rule.
