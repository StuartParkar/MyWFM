# Control Tower

The company-wide staffing/coverage/exceptions dashboard (build spec section
8), with drilldown from a single number down to the Calculation Ledger entry
that produced it ("Explain This Number," section 36).

## The 12 KPI cards

`GET /api/control-tower/summary?from=&to=&processId=&hodId=&tlId=&agentSeniorId=&designationCode=`
(`controlTower.service.ts`'s `getSummary`) computes all twelve in one call,
reusing the same formulas Phase 7 already built rather than a second,
parallel implementation:

| KPI | Backed by | Filter scope |
|---|---|---|
| Planned HC | Sum of published Scheduled HC per requirement | Process + date only (Group A) |
| Required HC | Sum of published requirements' RequiredHC | Process + date only (Group A) |
| Staffing Gap | `STAFFING_GAP` | Process + date only (Group A) |
| Coverage | `ROSTER_COVERAGE_PCT` | Process + date only (Group A) |
| Calls | Sum of Offered Calls | Process + date only (Group A) |
| AHT | `AHT_SECONDS` | Process + date only (Group A) |
| Service Level | `SERVICE_LEVEL_PCT` | Process + date only (Group A) |
| Abandon Rate | `ABANDON_RATE_PCT` | Process + date only (Group A) |
| Occupancy | `OCCUPANCY_PCT` | Process + date only (Group A) |
| Present HC | Count of scheduled employees with a real attendance session | **Full cascade** (Group B) |
| Attendance | `ATTENDANCE_PCT` (new: Present HC / Planned HC x 100, company-wide) | **Full cascade** (Group B) |
| Shrinkage | `SHRINKAGE_PCT` | **Full cascade** (Group B) |

## Why two different filter scopes, not one

The Global Filter Bar's HOD -> TL -> Agent/Senior cascade and Designation
filter (`shared/src/types/filters.ts`) resolve to a specific set of
*employees*. That has a well-defined meaning for Present HC, Attendance %
and Shrinkage % - every one of those is fundamentally a per-employee fact
(an attendance session, a shrinkage entry) that a specific employee either
does or doesn't contribute to.

It does **not** have a well-defined meaning for a `roster.RosterRequirement`
row (a department/process/shift's headcount target, not any one person's)
or a `calls.QueueIntervalCall` row (a call into a queue, attributed to an
agent only when one actually answered it - see
`documentation/phone-system-mapping.md`). Silently picking *some* rule
anyway (e.g. "count the requirement if any published assignment matches
the HOD filter") would double- or under-count a requirement covered by
several employees only some of whom match, and would drop queue-grain
calls entirely (which have no employee attribution at all). Rather than
invent a rule with a quiet failure mode, these nine KPIs apply Process and
date-range filtering only - real, honest numbers for the selection that
*does* have a well-defined meaning, clearly labeled as company-wide on the
page itself.

Occupancy is a partial exception worth calling out: its own Present HC
input (the denominator) is deliberately the **unfiltered**, Process-wide
person-days count - matching Workload's own scope - not the same
hierarchy-filtered Present HC shown on its own KPI card. Two different
"Present HC" numbers exist for two different, individually correct
purposes; see the code comment in `controlTower.service.ts` before
"fixing" this.

## Explain This Number

Every KPI above except the six raw counts (Planned/Present/Required HC,
Calls) carries a `formulaCode`. Clicking "Explain this number" queries
`GET /api/formulas/ledger?formulaCode=<code>&from=<from>&to=<to>` (the
Calculation Ledger's own listing endpoint, extended with an optional
`from`/`to` range filter for exactly this - see `documentation/formulas.md`)
and shows every entry that formula wrote in the current date range: its
formula version, entity, business date, computed value and when it ran.

The six raw-count KPIs have no ledger entry to show - a plain count of real
rows is already its own explanation, and giving it a formula code just to
satisfy a drilldown UI would be exactly the kind of invented indirection
build spec section 2 rules out. Their card links nowhere; the underlying
data is one click away on `/workforce/staffing`, `/operations/calls` and
`/operations/attendance` instead.

## Screens

| Screen | Path | Permission |
|---|---|---|
| Control Tower | `/control-tower` | `controltower.view` |
