# Troubleshooting

**Backend won't start / crashes immediately with an environment error.**
`backend/src/config/env.ts` validates `process.env` eagerly and exits with a
readable list of what's missing. Copy `backend/.env.example` to `.env` and
fill every value in - there are no silent defaults for secrets or connection
details.

**Backend starts but `/api/system-health/detail` shows the database DOWN.**
The API is designed to boot even without a database connection (so
health-checks and system monitoring keep working) - see
`backend/src/server.ts`. Check `SQL_SERVER_HOST`/`PORT`/credentials, and that
the instance allows TCP connections and matches
`SQL_SERVER_ENCRYPT`/`SQL_SERVER_TRUST_SERVER_CERTIFICATE`.

**Login fails right after a fresh migrate.** You migrated the schema but
haven't seeded it: run `npm run db:seed --workspace=backend` (creates the
roles/permissions every login depends on), then either
`npm run create-admin --workspace=backend` or, for local dev only,
`npm run db:seed:dev --workspace=backend`.

**`npm run db:migrate` says a migration's checksum changed.** Someone edited
an already-applied migration file in place - this is refused on purpose
(`backend/src/db/migrate.ts`). Revert the edit and add a new migration file
instead.

**SQL Server Docker container never becomes healthy.** The `sqlcmd`
binary/path differs across `mcr.microsoft.com/mssql/server` image tags
(`mssql-tools` vs `mssql-tools18`) - the compose healthcheck tries both.
`docker compose logs db` usually shows the real reason (commonly: the SA
password doesn't meet SQL Server's complexity requirement).

**This project's own dev sandbox** has no Docker daemon and no `sqlcmd`
available, so the Docker Compose stack and the live-SQL-Server-backup path in
`scripts/backup-mywfm.sh` were written carefully but could not be exercised
end-to-end here - they were verified module-by-module instead (migration
runner logic, backup file assembly and validation, etc.) using mocked/absent
DB connectivity. If you hit something that looks wrong in either, it's the
most likely place to look first.
