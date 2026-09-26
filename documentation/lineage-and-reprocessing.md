# Data Lineage & Reprocessing (Phase 11)

Build spec section 23: "KPI -> calculation -> formula version -> normalized
data -> import -> original file" should be traceable, and an authorized
person should be able to ask for a recalculation. Both pieces below reuse
real, already-existing machinery rather than inventing a second calculation
path or a second source-of-truth table.

## Data Lineage (`/data/data-lineage`)

`formula.CalculationLedger` (migration `0010_calculation_engine.sql`) has
carried `InputsSnapshot` (JSON) and `SourceReference` since Phase 7, but
until now nothing ever read `InputsSnapshot` back, and nothing ever *wrote* a
real `SourceReference` - every formula family computed it as `null`
(`documentation/formulas.md` used to say so, and for Shrinkage/Staffing/
Forecast/Attrition Rate that is still exactly true, honestly). Two real gaps
closed this phase:

- **`GET /api/formulas/ledger/:id`** (`formula.service.ts`'s
  `getCalculationLineage`) is the first place `InputsSnapshot` is ever
  actually read back - one Calculation Ledger row's full computed inputs,
  not just the already-listable summary `GET /api/formulas/ledger` gives.
- **Calls-derived formulas now populate a real `SourceReference`.**
  `calls.QueueIntervalCall`/`AgentIntervalCall` have carried a real
  `ImportRunId` foreign key since Phase 6 - it was never threaded into the
  Calculation Ledger. `callMetrics.repository.ts`'s raw query now also
  returns the distinct `ImportRunId`(s) behind each aggregated bucket, and
  `callMetrics.service.ts`'s `buildImportSourceReference` turns them into
  real `IMPORT-00000007`-style code(s) - de-duplicated, sorted, and
  gracefully truncated (`,+N more`) if more import runs fed one bucket than
  fit in `SourceReference`'s `NVARCHAR(100)`. `listByProcess`'s roll-up
  unions every contributing queue's import runs, not just the first one.

Every other formula family (Shrinkage, Staffing Coverage/Capacity, Forecast,
Attrition Rate) is computed from live or manually-entered data - roster,
attendance, employee master data - not a specific uploaded file, so
`SourceReference` stays honestly `null` for them and the Data Lineage screen
says exactly that ("Not computed from a specific import run") instead of
guessing or hiding the gap.

The screen accepts either a raw `CalculationLedgerId` or the
`CALC-00000042` display code (whichever you have on hand), and a "View
lineage" link on Custom Reports and Control Tower's "Explain this number"
table both deep-link into it.

## Reprocessing (`/data/reprocessing`)

Every formula family already recomputes and writes a fresh Calculation
Ledger row **on every normal read** (`documentation/formulas.md`) - Shrinkage,
Staffing, Calls, Forecast and Attrition Rate all "reprocess" every single
time their screen loads. That makes a literal new calculation pointless to
build here; what was actually missing was a way for an **authorized,
reasoned, on-demand** request for one to be a first-class, audited fact,
distinguishable from someone simply reloading a report.

`POST /api/reprocessing` (`reprocessing.service.ts`'s `runReprocessing`)
takes a `calculationType`, a date range, a mandatory `reason`, and (per
calculation type) the real dimension filters that calculation's own service
function already supports:

| `calculationType` | Dispatches to | Real scope filters |
|---|---|---|
| `SHRINKAGE` | `shrinkage.service.listDailyShrinkage` | `employeeId` |
| `STAFFING_COVERAGE` | `staffing.service.listCoverage` | `departmentId`, `processId` |
| `STAFFING_CAPACITY` | `staffing.service.listCapacityByProcess` | `processId` |
| `CALLS_BY_QUEUE` | `callMetrics.service.listByQueue` | `queueId` |
| `CALLS_BY_PROCESS` | `callMetrics.service.listByProcess` | `processId` |
| `FORECAST` | `forecast.service.getForecast` | `queueId` |
| `ATTRITION` | `attrition.service.getSummary` | `departmentId`, `processId`, `locationId`, `designationId` |

No new math is introduced - this is exactly what loading that calculation's
own screen already does, just triggered explicitly and logged. The request
(scope, reason, requester, result, and whether it succeeded) is written to
`system.ReprocessingRequest` and to the audit log
(`recordAudit`) regardless of outcome: a request whose underlying
calculation throws is recorded with `status = 'FAILED'` and the real error
message, not silently swallowed or surfaced as a generic 500 - the failure
itself is the honest, recorded result.

`SHRINKAGE`'s `employeeId` filter has no picker in the UI today (this
codebase has no employee-search-to-select component yet, only Admin >
Employees' own search-and-list) - the API supports it, but the Reprocessing
screen itself only exposes the date range for that one calculation type.
An `employeeId`-level reprocessing request can still be made directly
against the API.

### Permissions

`reprocessing.view` (history) and `reprocessing.execute` (trigger) - WFM and
ADMIN only, matching `system.health.view`/`job.manage`'s precedent that
operational governance tools aren't given to HOD/Leader/Requestor roles.
Data Lineage reuses `formula.view` rather than a new permission - it's a
deeper read of the same Calculation Ledger that endpoint already lists, not
a new resource.
