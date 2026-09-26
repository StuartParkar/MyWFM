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

## What's not built, and why

Build spec sections 17-19 and 21 name several more formulas. None of them are
invented here, because each is missing a real input:

- **Answer Rate, Abandon Rate, AHT, Workload, Service Level, Occupancy**
  (sections 17-18) all need call volume - real call-detail data now exists
  (Phase 6: `calls.QueueIntervalCall`/`AgentIntervalCall`, loaded from real
  Vonage/Elevate/RingCentral exports; see
  `documentation/phone-system-mapping.md`), but these specific aggregate
  formulas are not yet built against it - each is computed from many
  individual call rows over an interval, and that aggregation logic doesn't
  exist yet.
- **Required Productive HC / Capacity / Capacity Utilization** (section 19)
  are the *workload-derived* half of the Staffing Engine - same blocker as
  above. The `RequiredHC` used by Roster Coverage/Staffing Gap above is the
  human-entered roster requirement value instead, which is real today.
- **Forecast Engine** (section 21) forecasts call volume from historical call
  volume - same blocker as above (the aggregation these formulas need isn't
  built yet, not a lack of underlying call data anymore).
- **Attrition** (section 22) needs employee join/leave dates, which have been
  promised but not yet provided (see the org-hierarchy import's own
  documentation) - opening/closing HC and attrition rate would otherwise be
  guessed at.

Each of these gets built the moment its real input exists, not before.

## Screens

| Screen | Path | Permission |
|---|---|---|
| Formula Library | `/admin/formula-library` | `formula.view` |
| Shrinkage | `/operations/shrinkage` | `shrinkage.view` to see, `shrinkage.manage` to record/adjust/remove |
| Staffing | `/workforce/staffing` | `staffing.view` |
