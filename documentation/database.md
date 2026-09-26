# Database

See `database/schema/README.md` for the conventions (schemas per domain, key
strategy, migrations-vs-programmability-objects split, idempotency, the `GO`
batch-splitting problem). This document is the current inventory and how to
operate the migration runner.

## Current schema (Phase 1)

| Schema | Table | Purpose |
|---|---|---|
| `security` | `Role`, `Permission`, `RolePermission` | RBAC definitions |
| `security` | `User`, `UserRole` | Login accounts and their role grants |
| `security` | `RefreshToken` | Hashed, rotated refresh tokens |
| `audit` | `AuditLog` | Who/what/when/where/before/after/reason/reference (section 44) |
| `config` | `ConfigurationSetting` | Versioned business-rule configuration (section 54) |
| `system` | `BackgroundJob` | Durable job queue (section 67) |
| `system` | `SchemaMigration` | Applied-migration tracking (created by the runner itself) |

| `master` | `Location`, `Process`, `Department`, `Designation` | Reference lookups |
| `master` | `Employee` | Self-referencing hierarchy (Sme/TeamLeader/Am/Manager/SrManager/UnitHod EmployeeId columns), `VacantTeamLeaderLabel` for "TBA-*" placeholders |
| `master` | `EmployeeProcess` | Many-to-many - a combined source value like "ABS/LBF" becomes two rows, not one literal Process |
| `master` | `Shift`, `Queue`, `Skill`, `EmployeeSkill`, `QueueSkillRequirement` | Master data with no real rows yet (nothing to seed without inventing it - see each Admin screen's empty state) |
| `master` | `Holiday`, `WeeklyOffPattern`, `ReasonCode` | Holiday calendar (real UI), and two lookups later phases populate categories into |
| `import` | `ImportRun` | One row per upload/CLI run, displayed as an `IMPORT-00000001`-style code |
| `import` | `DataQualityIssue` | One row per anomaly an import finds (severity, type, suggested action, status) - see `documentation/imports.md` |
| `roster` | `RosterRequirement`, `RosterRequirementAction`, `RosterRequirementAssignment` | The requirement + its full approval audit trail + proposed assignments - see `documentation/roster.md` |
| `roster` | `PublishedRoster` | The official roster, versioned - one active row per employee/date (`UX_PublishedRoster_ActiveSlot` filtered unique index), same never-overwrite discipline as `config.ConfigurationSetting` |
| `roster` | `RosterChange` | Confirmed shift/weekly-off changes outside the requirement workflow, with before/after `PublishedRoster` links |
| `attendance` | `AttendanceSession` | Login/logout sessions (multiple per employee/business date - see `documentation/attendance.md`); First Login/Last Logout/Net Working Hours are derived on read, never stored |
| `calls` | `QueueIntervalCall`, `AgentIntervalCall` | The universal call data model (build spec section 16) - two separate fact tables (different grains, never summed together), one row per real call (call-detail grain - migration `0011_calls_call_detail.sql` widened the original `0009_calls.sql` shape once real files disproved the initial pre-aggregated-interval assumption). Loaded via the four Phase 6 calls importers - see `documentation/imports.md` and `imports/samples/calls/README.md` |
| `shrinkage` | `ShrinkageCategory`, `ShrinkageEntry` | Unavailable time by category (Planned Leave, Training, Break, ...), manual entry / authorized adjustment - see `documentation/formulas.md` |
| `formula` | `FormulaDefinition` | The Formula Library's browsable catalog - metadata only (name/description/version/effective date), never an executable expression |
| `formula` | `CalculationLedger` | Every computed KPI value, its formula version and inputs, append-only - see `documentation/formulas.md` |
| `attendance` | `BreakSession` | Real break start/end tracking (`AttendanceSession.BreakMinutes` is an aggregate, not granular times) - see `documentation/intraday.md` |
| `intraday` | `ExceptionRule`, `Exception` | Configurable-threshold rule catalog and its detected -> acknowledged -> action taken -> resolved lifecycle - see `documentation/intraday.md` |
| `intraday` | `CapacityAdjustmentRequest` | Overtime and VTO (incl. early release) share one table, one `RequestType` discriminator - see `documentation/intraday.md` |
| `workforce` | `WorkforcePlan` | Versioned monthly HC target + planned hires/exits, any combination of Department/Process/Location/Designation - see `documentation/workforce.md` |
| `workforce` | `Scenario` | A saved what-if's input assumptions only - its projected outputs are computed on read, never stored - see `documentation/workforce.md` |

`master.Employee` is loaded from the real org hierarchy sample via
`npm run import:org-hierarchy --workspace=backend`
(`backend/src/scripts/importOrgHierarchy.ts`) - a two-pass loader (insert
employees, then resolve alias-based leader references now that every
employee exists) plus a derived-designation pass (an employee's own
DesignationId is the highest hierarchy level at which their EmployeeId is
referenced as someone *else's* leader; no such column exists in the source).
See `imports/samples/master-data/README.md` for the specific data-quality
anomalies it handles (alias trimming, `TBA-*` vacancies, a rare multi-name
cell, blank-vs-dash nulls).

`calls.QueueIntervalCall`/`AgentIntervalCall` are loaded from four real
phone-system exports via `npm run import:calls --workspace=backend -- <source>`
(`backend/src/scripts/importCalls.ts`) or the Data > Import Center screen.
Agent identity is resolved from each row's raw alias string against
`master.Employee.AliasName` (exact match, first-token split, then
known-suffix stripping); anything that doesn't resolve keeps the row with a
null `AgentId` and a logged `UNRESOLVED_CALL_PARTICIPANT` data-quality issue
rather than a guess. See `imports/samples/calls/README.md` for the specific
data-quality anomalies each source handles.

## Running migrations

```bash
npm run db:migrate --workspace=backend         # apply pending migrations + programmability objects
npm run db:migrate:status --workspace=backend  # report applied/pending/checksum-mismatch, no changes made
npm run db:seed --workspace=backend            # real reference data (roles, permissions, default config)
npm run db:seed:dev --workspace=backend        # DEMO DATA admin login - local dev only, refuses NODE_ENV=production
npm run create-admin --workspace=backend       # production bootstrap: creates one real ADMIN account
```

The runner (`backend/src/db/migrate.ts`) is intentionally simple:

1. Ensures `system.SchemaMigration` exists.
2. Applies every `database/migrations/*.sql` file not yet recorded there, in
   filename order, each inside one transaction. If a filename IS already
   recorded but its checksum has changed, it throws rather than silently
   re-running or ignoring the edit - migrations are append-only.
3. Re-applies every `.sql` file under `stored-procedures/`, `views/`,
   `functions/`, `triggers/` (all written as `CREATE OR ALTER`, so this is
   always safe and nothing is tracked for them).

## Why a stored procedure for login

`security.usp_GetUserAuthProfile` fetches the user row, their roles, and the
flattened permission set granted by those roles in one round trip, because
it runs on every login and every access-token refresh. This is the only
stored procedure Phase 1 needed; see `database/stored-procedures/README`-style
reasoning in `database/schema/README.md` for when a query becomes "stored
procedure-worthy" versus staying as parameterized SQL in a repository file.

## Historical immutability

`config.ConfigurationSetting` enforces "exactly one active version per key" at
the database level (a filtered unique index), not just in application code -
changing a setting always inserts a new `Version` row rather than overwriting
one in place. `roster.PublishedRoster` now applies the identical pattern
(`UX_PublishedRoster_ActiveSlot`, `WHERE IsActive = 1`) - publishing a change
deactivates the previous row instead of overwriting it. The same discipline
will apply to `CALC-*` formula versions once Phase 7 builds them.
