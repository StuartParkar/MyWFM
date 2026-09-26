# Formula & Rule Library

The deterministic Calculation Engine (build spec sections 32-33): every KPI
this system produces is a reviewed TypeScript function, versioned in a
browsable catalog, whose result is written to an append-only ledger rather
than just handed back in an API response and forgotten.

## The Calculation Engine is a catalog, not a runtime expression evaluator

`formula.FormulaDefinition` (migration `0010_calculation_engine.sql`) stores
each formula's `FormulaCode`, `Version`, `Name`, `Description`, `Category` and
`EffectiveFrom` - metadata only. Build spec section 2 is explicit that
calculations must be deterministic TypeScript/SQL, never an AI or a
runtime-evaluated rule string; inventing a formula-expression language so the
database could "store the formula itself" would quietly reintroduce the kind
of dynamic, unreviewed logic section 2 rules out. The actual computation for
each row below lives in ordinary, reviewed backend code - this table just
lets it be *browsed* (Admin > Formula Library), with exactly one active
version per code (`UX_FormulaDefinition_ActiveCode`, same discipline as
`config.ConfigurationSetting`).

## The Calculation Ledger

`formula.CalculationLedger` is append-only: a recalculation after a data
correction inserts a new row rather than overwriting the old one, so "what
did we compute, and with what formula version, at the time" is never lost
(this is what build spec section 23's Data Lineage will read from, once
Phase 11 builds that screen). Each row is displayed as a `CALC-00000001`-style
code (`toCalculationCode`, the same `padStart(8, "0")` convention as
`import.ImportRun`'s `IMPORT-*` codes), and records:

- `FormulaCode` + `FormulaVersion` (shown together as `SHRINKAGE_PCT-V1`,
  matching the build spec's own `SHRINKAGE-V1`/`STAFFING-V1` naming - kept as
  two normalized columns underneath rather than baking the version into the
  code string itself, the same way `config.ConfigurationSetting` and
  `roster.PublishedRoster` keep `Version` as its own column).
- `EntityType`/`EntityId`/`BusinessDate` - what the calculation is about.
- `ComputedValue` and `InputsSnapshot` (JSON) - the number and what produced it.
- `SourceReference` - the build spec's "Source Data Version" (e.g. an
  `IMPORT-*` code). **Always null today**: Shrinkage and Staffing both compute
  from manually entered/roster data, not an import run, so there is nothing
  real to cite. A future formula computed from imported data (Calls, once it
  has one) would populate this.
- `ComputedByUserId` - the user whose request triggered the computation.
  There is no scheduled/background calculation job yet (no cron
  infrastructure exists - see `documentation/troubleshooting.md` /
  `system.BackgroundJob`), so every ledger row today traces to a real person
  loading a screen, not a fabricated `SYSTEM` actor.

Values are computed **on read, every time** (Shrinkage and Staffing's list
endpoints both write a ledger row as a side effect of answering the request),
not on a schedule - there is nowhere to hang a "nightly recalculation job" on
yet. This is different from Attendance's derived fields (Phase 5), which are
computed on read and *never* persisted; the ledger exists specifically because
these two formulas are named in build spec section 33 as needing a stored,
historical record, not just a live number.

## What's implemented

| Formula | Code | Formula | Source |
|---|---|---|---|
| Shrinkage % | `SHRINKAGE_PCT` | Unavailable Minutes / Scheduled Minutes x 100 (build spec section 20) | `shrinkage.service.ts` |
| Roster Coverage % | `ROSTER_COVERAGE_PCT` | Scheduled HC / Required HC x 100 | `staffing.service.ts` |
| Staffing Gap | `STAFFING_GAP` | Scheduled HC - Required HC | `staffing.service.ts` |
| Actual Staffing Gap | `ACTUAL_STAFFING_GAP` | Present HC - Required HC | `staffing.service.ts` |

All four use **real** inputs already in the system: Scheduled Hours/HC comes
from `roster.PublishedRoster` (via `attendance.service.ts`'s
`computeScheduledWindow`, shared rather than re-derived a second time),
Required HC is the human-entered value on a **published**
`roster.RosterRequirement` (never the workload-derived version below), and
Present HC/Unavailable Minutes come from real `attendance.AttendanceSession`
and `shrinkage.ShrinkageEntry` rows. Scheduled/Required HC of `0` divides
safely: the percentage is reported `null` rather than `Infinity` or a
fabricated number, while the gap formulas (plain subtraction) still report a
real value.

Staffing's coverage is computed **per published roster requirement**, using
the exact `PublishedRoster.RosterRequirementId` link Phase 4's
`publishRequirement()` already establishes - not a separately re-derived
department/process/shift grouping, which would risk quietly disagreeing with
what was actually published.

## Call-derived formulas (build spec sections 17-19)

Aggregated per (BusinessDate, QueueId) from real `calls.QueueIntervalCall`
rows (`backend/src/modules/calls/callMetrics.repository.ts` /
`callMetrics.service.ts`) - deliberately daily/summary grain, not
interval-level (interval-level Calls/AHT/Occupancy/Service Level is Phase 9's
Intraday Control, a different screen with a different grain):

| Formula | Code | Formula |
|---|---|---|
| Answer Rate % | `ANSWER_RATE_PCT` | Answered / Offered x 100 |
| Abandon Rate % | `ABANDON_RATE_PCT` | Abandoned / Offered x 100 |
| Average Handle Time | `AHT_SECONDS` | mean(HandleSeconds, falling back to TalkSeconds+HoldSeconds+ACWSeconds when a source doesn't report HandleSeconds directly - e.g. Vonage QueueWise) over answered calls |
| Service Level % | `SERVICE_LEVEL_PCT` | (answered calls with WaitSeconds <= `calls.service_level_threshold_seconds`) / Offered x 100 - denominator is Offered, not Answered, the stricter common SLA definition where an abandoned call also counts against it |
| Workload (agent-hours) | `WORKLOAD_HOURS` | Offered x AHT Seconds / 3600 |

`OFFERED_CALLS`/`ANSWERED_CALLS`/`ABANDONED_CALLS` are cataloged in the
Formula Library for documentation but, like Staffing's own RequiredHC/
ScheduledHC/PresentHC above, aren't given their own ledger rows - they're the
raw inputs the five ratios above are computed from, captured in each ratio's
`InputsSnapshot` instead.

A roll-up to (BusinessDate, ProcessId) is available via a second endpoint
(`GET /api/calls/metrics/by-process`) for the workload-derived Staffing
formulas below - it sums the raw counts across every queue sharing that
process *first*, then computes the ratios once, never by averaging each
queue's own already-computed percentage (mathematically wrong). A queue only
contributes to a process roll-up once its Process is assigned in
Admin > Queues - an auto-created queue from a Calls import starts
unassigned, since nothing in a phone-system export says which process it
belongs to.

## Workload-derived Staffing (section 19)

Computed per (BusinessDate, ProcessId) - a different grain from Roster
Coverage/Staffing Gap's per-RosterRequirement rows above, because call
workload doesn't know which of a process's (possibly several) shifts/
requirements answers it (`staffing.service.ts`'s `listCapacityByProcess`,
`GET /api/staffing/capacity`):

| Formula | Code | Formula |
|---|---|---|
| Capacity (productive agent-hours) | `CAPACITY_HOURS` | Scheduled Hours x (1 - Shrinkage %) - using each employee's *real* scheduled shift length (the same computeScheduledWindow Attendance/Shrinkage already use), not an assumed one |
| Required Productive HC | `REQUIRED_PRODUCTIVE_HC` | Workload Hours / (`staffing.standard_shift_hours` x (1 - Shrinkage %)) - a hypothetical "how many agents" headcount question has no real per-agent value to measure, so this one formula does use the configurable standard shift length |
| Capacity Utilization % | `CAPACITY_UTILIZATION_PCT` | Workload Hours / Capacity Hours x 100 |
| Occupancy % | `OCCUPANCY_PCT` | Workload Hours / (Present HC x `staffing.standard_shift_hours`) x 100 - uses the same configurable shift length rather than each present agent's real logged-in hours, which aren't wired in yet |

A process with call workload but nobody published to it (or vice versa)
reports `null` for the ratios that need the missing side, never a
divide-by-zero or a guessed value - see `workforce/staffing`'s Capacity
table.

## Forecast Engine (section 21)

`backend/src/modules/forecast/` (`GET /api/forecast`,
`GET /api/forecast/accuracy`) - deterministic, not AI, computed entirely from
real historical `calls.QueueIntervalCall` volume per queue:

**`CALL_VOLUME_FORECAST`** = Base Forecast x Trend Factor x Seasonality
Factor x Holiday Factor, for each requested date:

- **Base Forecast**: the plain average of Offered Calls over the trailing
  `forecast.trend_lookback_weeks` (default 4) weeks before the target date -
  every real day in that window, any weekday.
- **Trend Factor**: (average of the *recent* half of that same trend window)
  / (average of its *older* half) - clamped to [0.5, 2] so a short, noisy
  history can't extrapolate wildly. 1.0 (neutral) when there isn't enough
  history to split meaningfully.
- **Seasonality Factor**: (average Offered Calls on the target's specific
  weekday, over the trailing `forecast.seasonality_lookback_weeks` (default
  8) weeks) / (average over *all* weekdays in that same window) - how much
  busier or quieter this weekday is than an average day.
- **Holiday Factor**: `forecast.holiday_volume_factor` (default **1**,
  neutral) when the target date is a `master.Holiday` date, else 1. Left
  neutral rather than assuming a direction - most call centers see less
  volume on a holiday, but a travel BPO plausibly sees *more* around one, and
  there isn't yet enough real multi-holiday history to measure which. Revisit
  once there is.

A date with no real history strictly before it (a brand-new queue, or a
queue whose only imported sample rows are all on or after that date) reports
every factor and the forecast itself as `null` - "insufficient history," not
a fabricated number.

**`FORECAST_MAE`/`FORECAST_MAPE`/`FORECAST_BIAS`**: accuracy, computed by
comparing each date's forecast - built only from history strictly before
it, exactly what a real forecast would have seen in advance - against that
date's real actual, wherever both exist in the requested range:

- MAE = mean(|Forecast - Actual|)
- MAPE = mean(|Forecast - Actual| / Actual) x 100 (days with Actual = 0
  excluded, division by zero)
- Bias = mean(Forecast - Actual) - positive means the engine over-forecasts

With the real sample call data imported so far (a handful of non-contiguous
real dates per source - see `imports/samples/calls/README.md`), most
forecast requests will honestly report insufficient history. That's
expected, not a bug - the engine gets more useful precisely as more real
call history accumulates, not before.

## What's still not built, and why

- **Attrition** (section 22) needs employee join/leave dates, which have been
  promised but not yet provided (see the org-hierarchy import's own
  documentation) - opening/closing HC and attrition rate would otherwise be
  guessed at.
- **Interval-level** Calls/AHT/Occupancy/Service Level (as opposed to the
  daily/summary versions above) is Intraday Control, Phase 9 - a genuinely
  different grain and screen, not an oversight here.

Each of these gets built the moment its real input (or its phase) arrives,
not before.

## Screens

| Screen | Path | Permission |
|---|---|---|
| Formula Library | `/admin/formula-library` | `formula.view` |
| Shrinkage | `/operations/shrinkage` | `shrinkage.view` to see, `shrinkage.manage` to record/adjust/remove |
| Staffing (Coverage + Capacity) | `/workforce/staffing` | `staffing.view` |
| Forecast | `/workforce/forecast` | `forecast.view` |
| Admin > Queues (Process assignment) | `/admin/queues` | `masterdata.view` to see, `masterdata.manage` to assign a Process |
