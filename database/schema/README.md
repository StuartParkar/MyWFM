# Database Conventions

Full narrative in `documentation/database.md`. This file is the quick-reference
kept next to the schema itself.

## Schema-per-domain

Tables live in SQL Server schemas (not all in `dbo`), one per functional domain,
matching build-spec section 57 ("Separate: Master, Transactional, Fact,
Aggregation, Configuration, Audit, Calculation, Import, Security, Workflow").
Phase 1 creates: `security`, `config`, `audit`, `system`. Later phases add
`master`, `roster`, `attendance`, `calls`, `calc`, `import`, `workflow`,
`forecast`, as those subsystems are built - not before.

## Keys

- Every table has a surrogate primary key (`IDENTITY` for high-volume
  log/queue/fact tables where insert order is the natural access pattern and
  external guessability doesn't matter; `UNIQUEIDENTIFIER DEFAULT
  NEWSEQUENTIALID()` for entities referenced across modules/APIs, e.g. `User`).
- Natural/business keys (e.g. `RoleCode`, `SettingKey`, a future `EmployeeCode`)
  are always a separate `UNIQUE` constraint, never the primary key (build spec
  section 58).
- Source-system identifiers (once external imports exist, Phase 3+) are stored
  alongside the internal id, never used as the internal id.

## Migrations vs. programmability objects

- `database/migrations/*.sql` - numbered, append-only, structural changes
  (schemas, tables, constraints, structural indexes). Tracked one-by-one in
  `system.SchemaMigration` and applied exactly once, in filename order.
- `database/stored-procedures/`, `database/views/`, `database/functions/`,
  `database/triggers/` - source of truth for these objects, written as
  `CREATE OR ALTER`. The runner re-applies every file in these folders on every
  deploy (idempotent by construction), so there is nothing to track in
  `system.SchemaMigration` for them.
- `database/tables/` and `database/indexes/` are documentation folders, not
  executed by the runner. Phase 1's schema is small enough that the migration
  files themselves are the readable source of truth; mirror files will be added
  here once the schema is large enough that a migration-history read is no
  longer the fastest way to see a table's current shape. Until then, treat an
  empty folder here as a deliberate choice, not a gap.

## Idempotency

Every migration and every seed script must be safe to re-run
(`IF NOT EXISTS` / `MERGE`), because `database/seed-data/*.sql` reference rows
(roles, permissions, default configuration) are re-applied by
`npm run db:seed`, and a fresh environment plus a restored backup must both be
able to run the same scripts without manual bookkeeping.

## GO batch separator

`GO` is a SQLCMD/SSMS convention, not real T-SQL - the `mssql` Node driver
doesn't understand it. The migration runner (`backend/src/db/migrate.ts`)
splits each file on lines that are exactly `GO` and executes the batches in
order inside one transaction per migration file. `CREATE SCHEMA` must be the
first statement in its batch, so every migration that creates a schema puts
`GO` immediately after it.
