# Workforce & Scenario Planning (Phase 10)

Forward-looking headcount planning (`workforce.WorkforcePlan`) and saved
what-if scenarios (`workforce.Scenario`) - build spec section 20's two
remaining Workforce screens, both genuinely new concepts (a plan's target
and a scenario's assumptions are entered, not derivable from historical
data the way every earlier phase's numbers were).

## Workforce Planning

`GET /api/workforce/plans?from=&to=&departmentId=&processId=&locationId=&designationId=`
(`workforce.service.ts`'s `listPlansWithProjection`) returns, per plan:

| Column | Source |
|---|---|
| Current HC | Real, live `master.Employee` count matching the plan's own dimensions |
| Required HC | Entered target (versioned) |
| Planned Hires / Exits | Entered (versioned) |
| Future HC | `Current HC + PlannedHiresHC - PlannedExitsHC` |
| Hiring Gap | `RequiredHC - FutureHC` |

**Any combination of Department/Process/Location/Designation** - each is
independently nullable on `workforce.WorkforcePlan`, the same "not broken
down by this one" convention `roster.RosterRequirement` already uses.
`POST /api/workforce/plans` (`workforce.planning.manage`) rejects a plan
with *all four* null - that would silently mean "the whole company," never
what a real plan here means; every plan names at least one real dimension.

**Versioned, never overwritten.** Editing a plan (same BusinessMonth +
dimension combination) deactivates the previous row and inserts a new one
at `Version + 1` - identical to how `roster.PublishedRoster` and
`config.ConfigurationSetting` are already versioned. Because the four
dimension columns are nullable, a plain unique index on them would treat
every `NULL` as distinct (SQL Server's own semantics) and never catch a
real duplicate - `DepartmentKey`/`ProcessKey`/`LocationKey`/`DesignationKey`
are `PERSISTED` computed columns (`ISNULL(..., -1)`) that
`UX_WorkforcePlan_ActiveKey` actually indexes, the same sentinel-column fix
`intraday.Exception.IntervalStart` already uses for the same underlying
problem.

**Current HC by Process uses `master.EmployeeProcess`, not a roster
assignment.** Every earlier phase (Roster, Staffing, Control Tower,
Intraday) attributes "process" via a published roster requirement's own
`ProcessId` - the right relationship for scheduling and coverage questions,
but not what Current HC means: a plan asks "how many people currently
belong to this process," independent of whether they have a published
assignment for any particular day. `master.EmployeeProcess`
(`EmployeeId, ProcessId, IsPrimary`) already exists and is populated by the
org-hierarchy import (Phase 2/3) but had never been read by anything before
this - Current HC counts each employee once, via their `IsPrimary = 1`
process, so cross-process totals never double-count someone linked to more
than one.

**Future HC is stated cumulatively per plan row, not month-over-month.** A
plan for March's `PlannedHiresHC`/`PlannedExitsHC` means "how many more
hires/exits are expected between today and March," entered that way by the
WFM - not an incremental delta from February's own plan that would need
reconciling against every earlier month's plan for the same dimension key.
Each row is self-contained and independently correct.

**Why there's no real attrition-driven projection.** `master.Employee.
JoinDate`/`LeftDate` exist but are never populated by the org-hierarchy
import (the same gap `documentation/formulas.md`'s Attrition section
already documents) - Future HC does not pretend to read them; entered
planned hires/exits are the only input, an honest planning assumption
rather than a fabricated derivation from missing data.

## Scenario Planning

**Never touches live data**, exactly as the build spec requires: only a
scenario's own *input assumptions* are persisted
(`workforce.Scenario` - name, an optional Process filter, a real baseline
date range, and Volume/AHT/Shrinkage/HC change deltas). Every *output*
number is computed on read and returned in the API response only - never
written to any live table, and never to the Calculation Ledger (a
hypothetical number has no business in an audit trail of what the system
actually computed and used). This is the exact same principle Phase 9's
OT/VTO capacity-impact preview already established, generalized from one
employee's hours to a process's whole volume/AHT/shrinkage/HC picture.

`GET /api/workforce/scenarios/:id/evaluate` (a saved scenario) and
`POST /api/workforce/scenarios/preview` (an unsaved draft, for trying
inputs before committing to them) share one evaluation:

1. **Baseline** - real data for the scenario's own `(ProcessId,
   BaselineFrom, BaselineTo)`, reusing Phase 7's own formulas rather than a
   second, parallel implementation: `callMetrics.service.ts`'s
   `listByProcess` for Offered/Answered Calls and volume-weighted AHT
   (summed first, then divided once - the same discipline every other
   multi-row aggregation in this codebase already follows), and
   `staffing.service.ts`'s `listCapacityByProcess`, averaged across the
   range for Scheduled HC and Shrinkage % (a headcount doesn't meaningfully
   *sum* across days the way a call count does - the same period-averaging
   Reports pages already use, e.g. the Attendance Report's
   `avgNetWorkingHours`).
2. **Projected** - the baseline with each delta applied
   (`Volume x (1 + VolumeChangePct/100)`, `AHT x (1 + AhtChangePct/100)`,
   `Shrinkage = ShrinkagePctOverride ?? baseline`, `HC = baseline + HcChange`),
   then Workload Hours/Required Productive HC/Capacity Hours/Capacity
   Utilization %/Staffing Gap recomputed from those adjusted inputs with
   the exact same formulas `staffing.service.ts` already uses - never a
   second, scenario-specific version of the math.

## Formula Library

No new formula codes - Scenario Planning's projected numbers reuse
`REQUIRED_PRODUCTIVE_HC`/`CAPACITY_HOURS`/`CAPACITY_UTILIZATION_PCT`'s exact
formulas in memory; they simply never get a Calculation Ledger row, since
they're hypothetical (see above).

## Permissions

| Code | Grants |
|---|---|
| `workforce.planning.view` | View Workforce Planning (WFM, HOD, LEADER) |
| `workforce.planning.manage` | Create/edit Workforce Plan targets (WFM) |
| `scenario.view` | View/evaluate saved scenarios (WFM, HOD) |
| `scenario.manage` | Create/edit/delete scenarios (WFM) |

## Screens

| Screen | Path | Permission |
|---|---|---|
| Workforce Planning | `/workforce/planning` | `workforce.planning.view` (+`workforce.planning.manage` to save a plan) |
| Scenarios | `/workforce/scenarios` | `scenario.view` (+`scenario.manage` to save/delete; preview is view-only) |
