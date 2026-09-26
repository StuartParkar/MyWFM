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
      or `npm run import:org-hierarchy --workspace=backend`). Phase 6 added
      four more source types (real phone-system call exports).
- [x] **Phase 4 - Roster**: requirement submission, the Requestor -> Leader ->
      HOD -> WFM approval workflow (permission checked against the
      requirement's current status, not just the route), versioned
      publication (`PublishedRoster`, same never-overwrite discipline as
      `config.ConfigurationSetting`), and a read-only Change Impact Simulator
      for shift changes. Admin/Requirements/Review/Approvals/Published
      Roster/Roster Changes screens are wired to real data - see
      `documentation/roster.md`.
- [x] **Phase 5 - Attendance & Business Day Engine**: the real overnight-shift-aware,
      timezone-aware `resolveBusinessDate`/`resolveGlobalBusinessDate`/`combineLocalDateTime`
      (superseding Phase 1's calendar-date placeholder - the Global Filter Bar now calls
      `GET /api/business-day/today`), attendance sessions (manual entry / authorized
      adjustment - no import source exists yet, nothing invented), and the derived
      formulas (Net Working Hours, Variance, Late/Early Minutes with configurable grace
      periods, Double Shift Exception). Operations > Attendance is wired to real data -
      see `documentation/attendance.md`.
- [x] **Phase 6 - Calls**: the universal call structure section 16 gives
      verbatim (`calls.QueueIntervalCall`/`AgentIntervalCall`, two separate
      fact tables - queue-level and agent-level records are different grains
      and are never summed together), built from real phone-system exports
      (Vonage QueueWise, Vonage Company Summary, Elevate, RingCentral),
      inspected column by column per section 76 before writing any mapping -
      see `documentation/phone-system-mapping.md` and
      `imports/samples/calls/README.md`. All three real systems export
      call-detail (one row per call), never pre-aggregated intervals.
      Agent-alias resolution handles the real floor-alias + inconsistent
      team-code-suffix scheme, flagging (never guessing) anything that
      doesn't resolve. Import via Data > Import Center (4 new source types)
      or `POST /api/calls/import/:source`; Operations > Calls reads the
      result. RingCentral's own `RingCentral`/`RingCentral - AgentWise`
      sheets were inspected but not mapped (wrong grain / unmapped format -
      see the calls README) and remain future work if needed.
- [x] **Phase 7 - Calculation engine & formulas (partial - only what real data
      supports)**: a versioned Formula Library (metadata catalog, not a
      runtime expression language) and an append-only Calculation Ledger
      (build spec sections 32-33), plus the two formula groups real data
      already exists for - Shrinkage % (manual entry, same pattern as
      Attendance) and Staffing (Roster Coverage %, Staffing Gap, Actual
      Staffing Gap, computed per *published* roster requirement against its
      own human-entered Required HC). Answer Rate/AHT/Workload/Service Level/
      Occupancy/Required Productive HC/Capacity Utilization and the Forecast
      Engine all need call volume - real call data now exists (Phase 6,
      above), but these specific formulas are not yet built against it;
      Attrition needs employee join/leave dates, promised but not yet
      provided. See `documentation/formulas.md`.
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
