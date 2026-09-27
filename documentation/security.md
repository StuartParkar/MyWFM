# Security

## Authentication

- Passwords hashed with bcrypt (`bcryptjs`, 12 salt rounds) - see
  `backend/src/modules/auth/password.ts`. Policy (min length, case, digit) is
  config-driven (`security.password_min_length`), not hard-coded.
- Access tokens are short-lived JWTs (`security.access_token_ttl_minutes`,
  default 15 min), signed with `JWT_ACCESS_SECRET`, returned in the login
  response body and held in memory by the frontend (`AuthContext`) - never in
  `localStorage`.
- Refresh tokens are opaque random values, HMAC-hashed at rest
  (`JWT_REFRESH_PEPPER`) so the database never holds a usable token, rotated
  on every refresh, and stored as an `httpOnly`, `sameSite=lax` cookie scoped
  to `/api/auth`. The frontend never reads this cookie directly - only the
  browser and the backend do.
- Account lockout: `security.max_failed_login_attempts` consecutive failures
  locks the account for `security.account_lockout_minutes`
  (`backend/src/modules/auth/auth.repository.ts`).
- Login failures return the same generic message whether the email doesn't
  exist or the password is wrong, to avoid user enumeration.

## RBAC (build spec section 43)

- Roles: `REQUESTOR`, `LEADER`, `HOD`, `WFM`, `ADMIN`
  (`shared/src/constants/roles.ts`, seeded by
  `database/seed-data/0001_roles_and_permissions.sql`).
- Permissions are `module.action` codes
  (`shared/src/constants/permissions.ts`). Phase 1 only defines the
  permissions Phase 1 actually enforces (`user.*`, `role.manage`, `config.*`,
  `audit.view`, `system.health.view`, `job.*`) - later phases add their own
  as those modules are built, rather than pre-declaring permissions for
  screens that don't exist.
- Enforcement is **always server-side**:
  `backend/src/middleware/auth.ts` verifies the JWT and attaches `req.user`;
  `backend/src/middleware/rbac.ts`'s `requirePermission(...)` checks
  `req.user.permissions` before a route handler runs. The frontend's
  `app/(app)/layout.tsx` redirect-if-unauthenticated is a UX convenience, not
  a security boundary.
- A startup check (`backend/src/config/rbacSync.ts`) compares the
  code-defined role/permission unions against the database rows and logs a
  warning (never a hard failure) on drift, so an ADMIN can extend RBAC data
  ahead of a code deploy without silently going unnoticed.

## Audit logging (build spec section 44)

Every auditable action calls `recordAudit()`
(`backend/src/modules/audit/audit.service.ts`), which writes who
(`performedByUserId`), what (`action`, `entityType`/`entityId`), when
(`performedAt`), before/after JSON, a free-text reason, a reference id, the
request's IP, and a correlation id tying it back to the structured log line
for that request. A failed audit write logs at `CRITICAL` rather than
throwing - a broken audit trail must never take down the operation it was
describing, but it also must never vanish silently.

Phase 1 wires this into login success/failure, logout, and admin account
bootstrap. Every later phase's workflow (roster approval, publication,
attendance adjustment, configuration change, ...) calls the same function.

## Transport and headers

`helmet()` sets standard secure headers; CORS is same-origin in practice
because the frontend proxies `/api/*` to the backend server-side (see
`architecture.md`) rather than the browser calling a different origin
directly - see `documentation/deployment.md` for when `CORS_ORIGIN` still
matters (direct API calls, e.g. from a script or Postman). `server.ts` sets
`keepAliveTimeout`/`headersTimeout` explicitly (Phase 12) rather than
leaving Node's defaults implicit.

## Rate limiting (Phase 12)

`backend/src/middleware/rateLimit.ts`'s `authRateLimiter`
(`express-rate-limit`, 20 requests / 15 min, keyed by IP) sits in front of
`POST /api/auth/login` and `POST /api/auth/refresh`. Before this, the only
brute-force cost was the per-account lockout in `auth.repository.ts`, which
only engages once an email resolves to a real, active account - hammering
the endpoint with unknown emails, or spreading attempts across many
accounts, had no cost at all.

## CSRF

Genuinely absent as a dedicated synchronizer-token layer, but the real
exposure is narrower than that sounds: every protected route requires a
bearer access token that only exists in the frontend's in-memory
`AuthContext` - a cross-site page has no way to obtain or attach it. The
**only** routes authenticated by a cookie alone are `POST /api/auth/refresh`
and `POST /api/auth/logout`, and both already sit behind `sameSite=lax`
(browsers don't attach a Lax cookie to a cross-site POST). Phase 12 adds one
more layer on top: `backend/src/middleware/requireFetchHeader.ts` rejects
either route unless `X-Requested-With: XMLHttpRequest` is present - a
plain cross-site `<form>` POST cannot set a custom header, so this closes
the gap even for browsers or configurations where SameSite enforcement is
weaker than expected. The frontend's `AuthContext` sends this header on
every call to either route.

## Dependencies (Phase 12)

`npm audit` is clean except for `vitest`/`vite`/`vite-node`/`@vitest/mocker`
(1 critical, 3 moderate - all dev-only, never shipped). The suggested fix
(`vitest@^5.0.2`) was attempted and reverted: it pulls in a `vite@8.x` whose
dependency chain (`rolldown`, then `obug`) was genuinely broken in this
environment - missing packages the installer never resolved, not a
version-compatibility problem. The one advisory rated critical
(GHSA-5xrq-8626-4rwp) only applies when `vitest --ui` is running, which this
project never does (`vitest run` only). Revisit the version bump once that
release line has stabilized. The other finding (`uuid` <11.1.1 via
`exceljs`) **is** fixed: a root `package.json` `overrides` entry pins
`uuid@^11.1.1` - verified safe by reading `exceljs`'s own source
(`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`),
which only ever calls `uuid.v4()` with no arguments, never the
caller-supplied-`buf` path the advisory is about.
