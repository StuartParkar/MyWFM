# Attrition

Opening/Closing HC, Joiners, Exits, Transfers and Attrition Rate (build spec
section 22) - deferred since Phase 7 because the one real org-hierarchy
source file
(`imports/samples/master-data/employee-org-hierarchy-2026-09-26.tsv`) has
no join-date or exit-date column at all (12 columns: Emp ID, Name, Alias
Name, Location, Process, Department, SME, Team Leader, AM, Manager,
Sr. Manager, Unit HOD - nothing date-related). Completed once two real
signals were built to feed it, rather than by inventing dates.

## Where the dates actually come from

`master.Employee.JoinDate`/`LeftDate` (added in Phase 2's migration `0004`,
never populated by anything until now):

- **The org-hierarchy importer sets them itself, going forward.** A brand
  new `EmployeeCode` (an `INSERT`, not an `UPDATE`, in the importer's own
  `MERGE`) gets `JoinDate = ` this run's own effective date - the honest
  (if imprecise) fact of "the date this system first learned about this
  employee," not a real HR hire date, since the source file has never
  provided one.
- **A currently-active employee missing from a later re-import is treated
  as exited** (`LeftDate` = that run's effective date, `IsActive = 0`) -
  the file is a full roster snapshot, so real absence is the only signal
  available. This is capped by `attrition.max_auto_exit_fraction` (seeded
  at 0.2): if more than that fraction of the current active roster is
  missing at once, the importer raises one HIGH data-quality issue instead
  of mass-deactivating - far more likely a partial/wrong file than real
  mass attrition (`MASS_EMPLOYEE_ABSENCE`, `orgHierarchyImporter.ts`'s
  `exceedsMassExitThreshold`).
- **Admin > Employees can set a real HR-confirmed date manually** (the
  backend has supported `joinDate`/`leftDate` since Phase 2's
  `masterdata.validation.ts` - only the frontend never exposed them until
  now). A manually-entered date is never touched again by the importer:
  `JoinDate` is only ever set on a fresh `INSERT`, and an exit only sets
  `LeftDate` when it's currently `NULL`.
- **Every employee that existed before this feature shipped was backfilled**
  (migration `0014_attrition.sql`) from their own real `CreatedAt` timestamp
  - not a fabricated date, but also not a real HR hire date; the honest
  best available answer to "since when has this system known about them."

`master.EmployeeTransfer` (new) is a dedicated append-only log, because a
Department/Location/primary-Process change has no history anywhere else -
`Employee`'s own columns only ever hold the *current* value. The importer
detects a transfer by comparing, for an already-matched `EmployeeCode`, its
old values (the `MERGE`'s own `OUTPUT DELETED.*` for Department/Location; a
`SELECT` immediately before the `DELETE`/re-`INSERT` into
`EmployeeProcess` for primary Process) against the new row - see
`orgHierarchyImporter.ts`'s `isRealTransfer`. A fresh `INSERT` is a join,
never a transfer, however different its fields look from nothing.

## Formulas

| Metric | Definition |
|---|---|
| Opening HC | Active as of the period's own start (`JoinDate < from`, not yet left) |
| Closing HC | Active as of the period's own end (`JoinDate <= to`, not yet left as of `to`) |
| Joiners | `JoinDate` within `[from, to]` |
| Exits | `LeftDate` within `[from, to]` |
| Transfers | `EmployeeTransfer.EffectiveDate` within `[from, to]` |
| Attrition Rate % | `ATTRITION_RATE_PCT` = Exits / ((Opening HC + Closing HC) / 2) x 100 |

Only Attrition Rate is ledger-logged (`ATTRITION_RATE_PCT`) - the five raw
counts follow the established "raw counts aren't their own ledger entries"
precedent (`documentation/formulas.md`). An employee who both joined and
exited within the same period counts in both Joiners and Exits but neither
Opening nor Closing HC - correct, standard attrition-reporting behavior,
not an arithmetic inconsistency.

**Dimension filters use each employee's *current* Department/Location/
Designation and *current* primary Process** (`master.EmployeeProcess.
IsPrimary = 1`) - the same simplification Workforce Planning's own Current
HC already makes (`documentation/workforce.md`): there is no historical
point-in-time snapshot of "what was employee X's department on date Y,"
only the discrete `EmployeeTransfer` change log. An employee who
transferred out of a process after a historical period counts under their
new process for that period's numbers, not their process at the time. A
Transfer counts toward a dimension filter if *either* its Previous or New
value matches, so a filtered view shows movement both into and out of it.

## Honest limits

- `employeesMissingJoinDate` (surfaced directly on the Attrition screen,
  not hidden) counts currently-active employees with no `JoinDate` at all.
  This should normally read 0 after migration `0014`'s one-time backfill;
  a non-zero count means a row was inserted some other way than the
  importer or Admin > Employees.
- A system-inferred join/exit date reflects when this system *observed*
  the change, not necessarily the real-world HR event date - most visible
  right after this feature ships, when every pre-existing employee's
  `JoinDate` is their `CreatedAt`, not their real hire date. A manually
  entered real date always wins going forward.
- `attrition.max_auto_exit_fraction` guards against a partial/wrong file
  being mistaken for mass attrition, but also means a *genuine* mass
  layoff larger than that threshold needs a human to confirm it (via
  Admin > Employees) rather than being auto-detected.

## Permissions

| Code | Grants |
|---|---|
| `attrition.view` | View Opening/Closing HC, Joiners, Exits, Transfers, Attrition Rate (WFM, HOD, LEADER) |

## Screens

| Screen | Path | Permission |
|---|---|---|
| Attrition | `/operations/attrition` | `attrition.view` |
