# Reports

Six screens under `/reports/*` (build spec, Phase 8), each adding
**period-over-period comparison** on top of an already-real endpoint from
Phases 5-7 - none of them introduce a new aggregation the underlying data
doesn't already support, and none re-derive a percentage by averaging
another percentage (the same "sum raw quantities, then compute the ratio
once" discipline as `callMetrics.service.ts`/`staffing.service.ts`).

`frontend/src/components/reports/PeriodComparison.tsx` is the one shared
piece: two `<PeriodRangePicker>`s (Period A/B, B defaulting to the same
length immediately before A) and a `formatDelta()` helper that colors a
Δ green/red by whether smaller or larger is the improvement for that
specific metric (`lowerIsBetter`), never asserting the change was
intentional - just its direction.

| Screen | Reuses | Notes |
|---|---|---|
| `/reports/staffing` | `GET /api/control-tower/summary` | Planned/Required HC, Staffing Gap, Coverage % - company-wide, both periods |
| `/reports/workforce` | `GET /api/control-tower/summary` + `GET /api/staffing/capacity` | Adds Capacity/Capacity Utilization (summed Workload/Capacity hours, ratio recomputed once) and average daily Required Productive HC (a per-day snapshot, so this one figure is a mean across the period, not a sum - labeled as such) |
| `/reports/calls` | `GET /api/control-tower/summary` + `GET /api/calls/metrics/by-process` | Offered/Answered/Abandoned are summed raw counts (safe); AHT/Service Level/Abandon Rate/Occupancy come from the summary endpoint, which already aggregates them correctly |
| `/reports/attendance` | `GET /api/attendance` | Avg net working hours/variance, absence/late/early-logout counts. Capped at the first 200 employee/day rows per period (no company-wide attendance aggregate endpoint exists) - the page says so plainly when a period has more |
| `/reports/forecast` | `GET /api/forecast/accuracy` | Direct pass-through, both periods |
| `/reports/roster` | `GET /api/control-tower/summary` + `GET /api/roster/changes` | Coverage % plus a count of confirmed `roster.RosterChange` rows (this system's version-history record) whose `businessDate` falls in the period - same 200-row cap and disclosure as Attendance |

## Custom Reports

`/reports/custom` is a more powerful, ad-hoc query over
`formula.CalculationLedger` than Admin > Formula Library's own ledger
browser (Phase 7): every filter dimension the backend supports together -
formula, entity type, entity id, *and* date range (Formula Library only
ever filters by formula code, and has no date range at all - see
`documentation/formulas.md`). There is no "save report" feature: nothing
persists a query server-side, so a report is "saved" by re-selecting the
same filters, or a future feature could capture the current URL/filter
state - not built here, since nothing asked for it and inventing storage
for it wasn't necessary to make the screen genuinely useful today.

## Reports > Exceptions stays unavailable

Build spec's own description ("exception volume and resolution reporting")
needs an exception *engine* to have volume to report on. That engine is
Phase 9's Intraday Control - nothing here would have real data to show, so
the nav item stays `available: false, phase: 9` rather than shipping an
empty page that looks like an oversight.

## Permissions

There is no separate `reports.view` permission. Each screen reuses an
already-gated endpoint, so it inherits that endpoint's own real,
server-enforced permission instead of a second, decorative one nothing
would ever actually check:

| Screen | Path | Requires |
|---|---|---|
| Workforce | `/reports/workforce` | `controltower.view` + `staffing.view` |
| Calls | `/reports/calls` | `controltower.view` + `calls.view` |
| Attendance | `/reports/attendance` | `attendance.view` |
| Staffing | `/reports/staffing` | `controltower.view` |
| Forecast | `/reports/forecast` | `forecast.view` |
| Roster | `/reports/roster` | `controltower.view` + `roster.view` |
| Custom Reports | `/reports/custom` | `formula.view` |
