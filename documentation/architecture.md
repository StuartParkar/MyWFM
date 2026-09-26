# Architecture

## Why this stack

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4.
  Component-based, server-rendered where it helps, client-rendered for the
  interactive shell (auth, filters). No AI dependency anywhere in the render
  path (build spec section 2).
- **Backend**: Node.js + TypeScript + Express 5. A plain REST API, not a
  framework-magic ORM app - see `database.md` for why raw SQL/stored
  procedures are used alongside a thin query layer instead of a full ORM.
- **Database**: Microsoft SQL Server, always. Nothing in this codebase reads
  or writes any other database engine, and nothing here ever will (build spec
  section 4/57).
- **Monorepo**: npm workspaces (`shared`, `backend`, `frontend`) - no extra
  tooling (Nx/Turborepo/pnpm) needed at this size, and npm is already on every
  machine with Node installed, which matters for the portability requirement
  in section 62.

## Request flow (today)

```
Browser
  -> Next.js (proxies /api/* to the backend - see frontend/next.config.ts)
    -> Express app (backend/src/app.ts)
      -> middleware: helmet, requestContext (correlation id), pino request log
      -> route (auth / audit / jobs / system-health)
        -> requireAuth (JWT) -> requirePermission (RBAC) -> handler
          -> repository (parameterized SQL / stored procedure via `mssql`)
            -> SQL Server
```

Every response is `{ success: true, data }` or `{ success: false, error }`
(`shared/src/types/api.ts`), and every error carries an `errorId` that also
appears in the structured server log line, so a user-facing message can
always be traced to full technical detail (build spec section 65).

## Project structure

```
shared/     TypeScript types, RBAC/permission constants, business-date math
            shared between frontend and backend
backend/    Express API - config, db (pool + migration runner), middleware,
            modules (auth, audit, health, jobs), scripts (create-admin, seedDev)
frontend/   Next.js app - the shell (sidebar/top bar/Global Filter Bar), auth
            context, and one real page per built module; everything else
            resolves to an honest "not yet implemented" page (see
            frontend/src/lib/nav/navTree.ts)
database/   migrations/ (numbered, tracked), stored-procedures/ (CREATE OR
            ALTER, re-applied every deploy), seed-data/ (real reference data),
            plus schema/tables/views/functions/triggers/indexes/backup
            (see database/schema/README.md for the exact convention)
docker/     Dockerfiles for backend and frontend (docker-compose.yml at root)
scripts/    dev-setup, backup/restore (.sh tested here, .ps1 for Windows)
imports/    templates/ (empty until Phase 3), samples/master-data/ (real org
            hierarchy data used to design Phase 2's schema), rejected/
documentation/  this folder
```

## What phase built what (so far)

Only Phase 1 (security/config/audit/system foundation) is built. See the
root `README.md` for the full phase tracker and what each subsequent phase
adds. Every nav item that isn't backed by Phase 1 renders `ComingSoon` with
the actual phase number it's scheduled for - that mapping lives in
`frontend/src/lib/nav/navTree.ts` and is the single source of truth for both
the sidebar and the placeholder pages.

## Deliberate non-decisions

- **No ORM.** `database/schema/README.md` explains why: this project's own
  project-structure spec organizes the database by raw SQL object type
  (tables/views/procedures/functions/triggers), which is a different
  philosophy than an ORM-first schema-as-code approach. A thin `mssql`
  wrapper plus hand-written parameterized SQL and stored procedures matches
  that philosophy and keeps full control over query plans for a system that
  is explicitly meant to handle millions of call/attendance rows later.
- **No Next.js Cache Components.** Next 16 makes Partial Prerendering opt-in
  via `cacheComponents` rather than default. This project does not enable it
  - the current pages are simple client-rendered screens against a separate
  backend, and adopting Cache Components is its own migration project graded
  against a much larger page surface than exists yet.
- **No middleware/proxy.ts.** Authentication is enforced by the backend
  (`requireAuth`/`requirePermission`), and the frontend's route protection is
  a client-side redirect in `app/(app)/layout.tsx` for UX only - the
  authoritative check is always server-side, per build spec section 43.
