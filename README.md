# Universal MyWFM

Company-wide Workforce Management Control Platform for a travel BPO. Built
phase by phase against a full enterprise WFM specification - see
`documentation/README.md` for the documentation index and
`documentation/architecture.md` for the system design.

No AI dependency at runtime: every calculation, forecast and alert is
deterministic SQL/TypeScript against configuration and historical data, never
an LLM call. SQL Server is the system of record.

## Quickstart

```bash
scripts/dev-setup.sh                        # copies .env files, npm install
# fill in backend/.env (SQL Server connection + secrets), or:
docker compose up -d db                      # use the bundled SQL Server container instead

npm run db:migrate --workspace=backend
npm run db:seed --workspace=backend          # required reference data (roles, permissions, config)
npm run db:seed:dev --workspace=backend      # optional: DEMO DATA admin@example.com / DemoPassword123!
npm run dev                                  # backend :4000, frontend :3000
```

Full walkthrough, Docker Compose, and production deployment:
`documentation/deployment.md`.

## Phase tracker

Built phase by phase (build spec section 74) - never all at once. A nav item
without a real page yet shows an honest "not yet implemented, arriving in
Phase N" screen instead of a fake one
(`frontend/src/lib/nav/navTree.ts` is the source of truth for this mapping).

- [x] **Phase 1 - Foundation**: project structure, frontend/backend/shared
      packages, SQL Server connection + migration runner, authentication +
      RBAC + audit foundation, versioned configuration, background job queue,
      Docker, backup/restore scripts, this documentation set.
- [x] **Phase 2 - Master data**: employees, departments, processes, HOD/TL
      hierarchy (self-referencing, alias-resolved), designations (derived
      from hierarchy references), shifts, queues, skills. Real org hierarchy
      loaded via `npm run import:org-hierarchy --workspace=backend`. Global
      Filter Bar's HOD->TL->Agent/Senior cascade and Admin > Employees/
      Organization/Queues/Skills/Shifts screens are wired to real data.
- [x] **Phase 3 - Import framework**: generic `import.ImportRun`/`DataQualityIssue`
      pipeline (staged->validated->normalized->duplicate-checked->
      data-quality-checked->merged), with the employee/organization hierarchy
      as its first real source type (upload via Admin > Data > Import Center,
      or `npm run import:org-hierarchy --workspace=backend`). No other source
      type exists yet - Calls stays unbuilt until real phone-system files
      arrive (section 76).
- [x] **Phase 4 - Roster**: requirement submission, the Requestor -> Leader ->
      HOD -> WFM approval workflow (permission checked against the
      requirement's current status, not just the route), versioned
      publication (`PublishedRoster`, same never-overwrite discipline as
      `config.ConfigurationSetting`), and a read-only Change Impact Simulator
      for shift changes. Admin/Requirements/Review/Approvals/Published
      Roster/Roster Changes screens are wired to real data - see
      `documentation/roster.md`.
- [ ] **Phase 5 - Attendance & Business Day Engine**.
- [ ] **Phase 6 - Calls**: universal call model, per-phone-system mapping, aggregation.
- [ ] **Phase 7 - Formula engine**: calculation ledger, staffing, shrinkage,
      AHT, occupancy, service level, forecast, attrition.
- [ ] **Phase 8 - Control Tower**: reports, filters, drilldowns, Explain This Number.
- [ ] **Phase 9 - Intraday**: exceptions, action tracker, break management, OT/VTO.
- [ ] **Phase 10 - Workforce & scenario planning**.
- [ ] **Phase 11 - Audit/lineage**: reprocessing, system health history, backup/restore automation.
- [ ] **Phase 12 - Hardening**: performance, security, tests, deployment package.

## Repository layout

```
shared/          Types, RBAC/permission constants, business-date math (frontend + backend)
backend/         Express API - see backend/README-equivalent docs in documentation/
frontend/        Next.js app - see frontend/README.md
database/        Migrations, stored procedures, seed data - see database/schema/README.md
docker/          Dockerfiles (docker-compose.yml at root)
scripts/         dev-setup, backup/restore
imports/         Templates, samples (including real org-hierarchy data), rejected records
documentation/   Architecture, database, security, API, deployment, backup/restore, testing docs
```

## Development

```bash
npm run dev         # backend + frontend
npm run build       # shared -> backend -> frontend
npm test            # shared + backend unit tests
npm run typecheck
npm run lint
```

See `documentation/testing.md` for what is and isn't covered yet, and
`documentation/troubleshooting.md` for common setup issues.
