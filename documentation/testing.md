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

None of these need a real SQL Server - they mock the DB layer or test pure
functions. There is no integration test against a live SQL Server yet,
because this project's own sandbox has no SQL Server reachable (no Docker
daemon, no `sqlcmd`) - see `documentation/troubleshooting.md`. If you have a
real SQL Server available, running `npm run db:migrate --workspace=backend`
against it is the actual end-to-end check for everything in `database/`.

## What's not covered yet (by design, not oversight)

Import tests, workflow tests, permission-scope tests beyond RBAC, and
performance tests (build spec section 70) all depend on modules that don't
exist yet (Phase 3+). Adding tests for them now would mean testing
placeholder behavior instead of real behavior.
