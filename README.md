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
- [ ] **Phase 2 - Master data**: employees, departments, processes, HOD/TL,
      designations, shifts, queues, skills - schema designed from the real
      org hierarchy in `imports/samples/master-data/`.
- [ ] **Phase 3 - Import framework**: staging, normalization, data quality, import logs.
- [ ] **Phase 4 - Roster**: requirement, approval workflow, versioning, publication.
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
