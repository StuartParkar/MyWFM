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
functions.

## Real-database integration tests (Phase 12)

```bash
npm run test:integration --workspace=backend   # requires backend/.env pointing at a reachable SQL Server
```

Kept in `backend/tests/integration/` and run via a separate
`vitest.integration.config.ts`, deliberately **not** part of `npm test` -
`npm test` stays portable and dependency-free on any machine, per section 62,
while this suite opts in when a real server is available. It migrates and
seeds the target database itself (both idempotent) before running.

This is genuinely new coverage: the original build sandbox had no SQL Server
reachable at all (see `documentation/troubleshooting.md`), so until this
phase, nothing in `database/` had ever executed against a real engine.
Running it for the first time immediately found two classes of bug no mock
could have caught: two migrations (`0008`, `0013`) used a column-level
`CHECK` constraint referencing another column, which SQL Server rejects
outright (error 8141); and three repository queries (roster, workforce,
staffing) used `proc` as a table alias, which SQL Server also rejects as
invalid syntax. Both are fixed - see `troubleshooting.md` for the exact
errors and the fix pattern, in case a future migration or query repeats
either mistake.

`realDatabase.test.ts` covers: migration idempotency (running `up` twice
applies nothing the second time), seed idempotency (`db:seed` twice, both
succeed), and `roster.publishRequirement`'s Phase 12 batched rewrite with
real fixture data (multi-employee publish in one call, version incrementing
correctly across a republish, the old version's rows actually deactivated).

## What's not covered yet (by design, not oversight)

Load/performance testing under real traffic (the missing indexes and N+1
fixes in Phase 12 were found by code inspection - see `security.md` and the
root README's Phase 12 entry - not by measuring an actual slow request), and
the `formula.CalculationLedger`-write-per-row pattern / `intraday.service.ts`
`scanForExceptions`'s per-process re-querying, both intentionally left
unfixed this phase (documented, not silently dropped) since they're bigger
architectural changes than a hardening pass should make unprompted.

The `backup.jobHandler.ts`'s actual `execFile` call (running the real
`scripts/backup-mywfm.sh`) is not unit tested, the same precedent as the
org-hierarchy importer's own raw-SQL orchestration: it is a thin shell-out
to an already-tested, already-documented script (`documentation/backup-restore.md`),
not business logic with a decision to verify.
