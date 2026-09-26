# Testing

## What's covered today

```bash
npm test   # runs shared, then backend (vitest)
```

- `shared/tests/businessDate.test.ts` - date-preset math (`resolveDateRangePreset`
  and its helpers), including a leap-year check and a year-boundary
  `LAST_MONTH` case. This is the project's first "Business Date Test" in the
  sense of build spec section 70, scoped to what actually exists (calendar
  math) rather than the Phase 5 shift-aware engine that doesn't exist yet.
- `backend/tests/password.test.ts` - hashing round-trip and password policy.
- `backend/tests/jwt.test.ts` - access token sign/verify, tamper and
  wrong-secret rejection.
- `backend/tests/rbac.test.ts` - `requirePermission` middleware: allows with
  every permission present, rejects on any missing, rejects with no user.
- `backend/tests/migrate.test.ts` - the `GO`-batch splitter, including that it
  doesn't false-split on `GO` appearing inside a string literal.
- `backend/tests/auditService.test.ts` - `recordAudit` builds the expected
  INSERT (mocked `mssql` pool) and logs `CRITICAL` instead of throwing on
  failure.
- Every module built since (Phases 3-10: imports, roster, attendance, calls,
  shrinkage/staffing/forecast/Control Tower; Phase 9's intraday
  interval-bucketing engine, exception engine and OT/VTO capacity-impact
  preview; Phase 10's Workforce Planning projection and Scenario Planning
  baseline/delta math; Attrition's join/exit/transfer detection
  (`orgHierarchyAttrition.test.ts`) and Opening/Closing HC/Attrition Rate
  math (`attritionService.test.ts`)) has its own `backend/tests/*.test.ts`
  following the same mock-the-repository-layer, exercise-the-real-service
  pattern - see each module's test file for exactly what it covers rather
  than this list restating every case; `npm test` runs all of them.
- Phase 11: `reprocessingService.test.ts` (dispatch to the right real
  calculation per `calculationType`, a failed underlying calculation
  recorded as `status: FAILED` rather than thrown, `buildScope`'s
  per-type field selection), `healthSnapshot.test.ts` (the real INSERT
  behind System Health's History view, including the database-down case),
  `callMetricsSourceReference.test.ts` (`buildImportSourceReference`'s
  dedup/sort/graceful-truncation as a pure function) and
  `calculationLineage.test.ts` (`parseImportRunIds` and
  `getCalculationLineage`'s honestly-empty `sourceImportRuns` when a
  formula wasn't computed from any import run).

None of these need a real SQL Server - they mock the DB layer or test pure
functions. There is no integration test against a live SQL Server yet,
because this project's own sandbox has no SQL Server reachable (no Docker
daemon, no `sqlcmd`) - see `documentation/troubleshooting.md`. If you have a
real SQL Server available, running `npm run db:migrate --workspace=backend`
against it is the actual end-to-end check for everything in `database/`.

## What's not covered yet (by design, not oversight)

Performance tests (build spec section 70), and anything depending on
Phase 12 (hardening) modules that don't exist yet. Adding tests for them now
would mean testing placeholder behavior instead of real behavior.

The `backup.jobHandler.ts`'s actual `execFile` call (running the real
`scripts/backup-mywfm.sh`) is not unit tested, the same precedent as the
org-hierarchy importer's own raw-SQL orchestration: it is a thin shell-out
to an already-tested, already-documented script (`documentation/backup-restore.md`),
not business logic with a decision to verify.
