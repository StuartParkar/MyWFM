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
- [x] **Phase 7 - Calculation engine & formulas**: a versioned Formula Library
      (metadata catalog, not a runtime expression language) and an
      append-only Calculation Ledger (build spec sections 32-33). Shrinkage %
      and Staffing (Roster Coverage %, Staffing Gap, Actual Staffing Gap) from
      Phase 5/4 data, plus every call-derived formula sections 17-19 name -
      Answer Rate, Abandon Rate, AHT, Service Level, Workload, and the
      workload-derived half of Staffing (Required Productive HC, Capacity,
      Capacity Utilization, Occupancy) - now that Phase 6 provides real call
      volume. The Forecast Engine (section 21: Base Forecast x Trend Factor x
      Seasonality Factor x Holiday Factor, deterministic, not AI) is built and
      live at `/workforce/forecast`, honestly reporting "insufficient
      history" rather than a guess wherever the real imported call history
      doesn't yet cover a date. Attrition (section 22) was deferred here at
      the time - the org-hierarchy source file had no join/leave-date
      column at all - and completed later; see the Attrition entry below.
      See `documentation/formulas.md`.
- [x] **Phase 8 - Control Tower & reporting**: the Control Tower's 12 KPI
      cards (`/control-tower`) replace Phase 1's all-dashes placeholder,
      computed company-wide against the Global Filter Bar's date range +
      Process (nine of them) or the full HOD/TL/Agent-Senior/Designation
      cascade (Present HC, Attendance %, Shrinkage % - the three that are
      genuinely per-employee facts; see `documentation/controltower.md` for
      why the other nine don't support that same cascade). "Explain This
      Number" drills into the real Calculation Ledger entries behind any
      derived KPI. Six Reports screens (Workforce/Calls/Attendance/Staffing/
      Forecast/Roster) add period-over-period comparison on top of the same
      real endpoints; Custom Reports is an ad-hoc Calculation Ledger query
      tool. Reports > Exceptions was unavailable at this point - no exception
      engine existed yet to report on (built in Phase 9 below).
- [x] **Phase 9 - Intraday**: an interval-bucketing engine
      (`intraday.interval_minutes`, default 30) computes Required/Scheduled/
      Present/Available HC, Staffing Gap, Calls/AHT/Service Level/Occupancy
      per bucket for one business date at Intraday Control (`/intraday/
      control`), correctly extending past calendar midnight for a genuinely
      overnight-owned shift. Break Management (`/intraday/breaks`) adds real
      `attendance.BreakSession` tracking against the same engine's projected
      coverage. A configurable-threshold exception engine (`intraday.
      ExceptionRule`/`intraday.Exception`) evaluates staffing, service level,
      attendance and data-quality breaches on demand (no cron), each at its
      own natural grain, with a strict detected -> acknowledged -> action
      taken -> resolved lifecycle (Exceptions + Actions screens) - this also
      unblocks Reports > Exceptions from Phase 8. Overtime/VTO
      (`intraday.CapacityAdjustmentRequest`, one table for both plus early
      release) adds a real single-employee before/after Staffing Gap preview,
      self-service submission resolved from the long-unused `security.
      [User].EmployeeId` link, and HOD/WFM approval. See
      `documentation/intraday.md`.
- [x] **Phase 10 - Workforce & scenario planning**: Workforce Planning
      (`/workforce/planning`) tracks Current (real, live headcount via
      `master.EmployeeProcess` - populated since Phase 2, never read before
      this)/Required (entered target)/Future (Current + this plan's own
      stated planned hires/exits) HC and the resulting Hiring Gap, at any
      combination of Department/Process/Location/Designation, versioned the
      same way Roster's own published assignments are. Scenarios
      (`/workforce/scenarios`) save only a what-if's input assumptions
      (volume/AHT/shrinkage/HC change against a real baseline period) -
      every projected number is recomputed on read with Phase 7's own
      formulas and never written anywhere, "never touches live data" taken
      literally. See `documentation/workforce.md`.
- [x] **Attrition** (build spec section 22, completed after Phase 10):
      Opening/Closing HC, Joiners, Exits, Transfers and Attrition Rate
      (`/operations/attrition`) - unblocked without inventing any data.
      `master.Employee.JoinDate`/`LeftDate` (real columns since Phase 2,
      never populated) are now set by the org-hierarchy importer itself
      (first-seen on a new employee code, last-seen-then-missing on a
      later re-import, capped by `attrition.max_auto_exit_fraction` so a
      partial/wrong file is never mistaken for mass attrition) or entered
      manually via Admin > Employees (always wins over the importer's own
      inference). A new `master.EmployeeTransfer` log captures
      Department/Location/primary-Process changes, which `Employee`'s own
      current-value columns can't. See `documentation/attrition.md`.
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
