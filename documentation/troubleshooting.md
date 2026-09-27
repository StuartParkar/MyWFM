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

**This project's own dev sandbox** had no Docker daemon and no `sqlcmd`
available through Phase 11, so the Docker Compose stack, every migration, and
every repository query were written carefully but could not be exercised
end-to-end - they were verified module-by-module instead (migration runner
logic, backup file assembly and validation, etc.) using mocked/absent DB
connectivity. Phase 12 got a real, reachable SQL Server and Docker for the
first time - see the two real bugs that surfaced immediately below, and
`documentation/testing.md`'s "Real-database integration tests" section.

**`Column CHECK constraint for column 'X' references another column`
(SQL Server error 8141).** A column-level `CHECK` can only reference the
column it's defined on; a constraint checking two columns against each other
(e.g. `SessionEnd > SessionStart`) must be a **table-level** constraint
instead (listed separately, not attached to one column's definition). Found
in migrations `0008` and `0013` - real, unavoidable errors that could not
have surfaced without a real SQL Server, since no mock reproduces the
server's own constraint-parsing rules.

**`Incorrect syntax near the keyword 'proc'`.** SQL Server rejects `proc` as
a table alias. Found in three repository files (`roster`, `workforce`,
`staffing`) that all joined `[master].Process` aliased as `proc` - renamed to
`mp` everywhere. If a future query hits the same error for a different
alias, it's the same class of problem: SQL Server has a short list of
contextually-reserved words that aren't in the standard reserved-keyword
list either, so this can't always be caught by inspection - test the actual
query against a real server.

**Docker Desktop won't start on Windows Home ("Docker Desktop is unable to
start" / `failed to connect to the docker API at npipe:...`).** Windows Home
editions have no Hyper-V, so Docker Desktop requires the WSL2 backend, which
isn't installed by default. From an elevated PowerShell: `wsl --install
--no-distribution` (Docker Desktop manages its own internal WSL distro,
so no user-facing Linux distribution is needed), then **restart the
machine** - the VirtualMachinePlatform component genuinely does not finish
activating until reboot, even though `wsl --status` starts reporting
correctly beforehand. After the restart, `wsl --status` should show
`Default Distribution: docker-desktop` and `docker info` should reach the
server.

**`docker compose up`'s SQL Server port conflicts with a local install.**
The compose file publishes `db` on host port 1433 by default
(`${SQL_SERVER_PORT:-1433}:1433`) - if something else on the host (a native
SQL Server instance, another compose stack) already owns 1433, set
`SQL_SERVER_PORT` to something else (e.g. `14330`) in your root `.env`
**before** `docker compose up`. This only changes the host-side mapping;
`backend`'s own `SQL_SERVER_PORT=1433` inside `docker-compose.yml` is the
container-internal port and is unaffected, since containers reach `db` over
the compose network, not through the published host port.

**Backend logs `Login failed for user 'sa'` even though the password is
correct.** This is SQL Server's actual error message when the connection's
initial catalog (`SQL_SERVER_DATABASE`) doesn't exist yet on the server - it
is not a credentials problem, and no more specific "database does not exist"
error comes back. Confirmed by testing the exact same credentials with
`database: 'master'` (works) vs. the real target database name (fails with
this same message) directly from inside the `backend` container. Fixed for
real by `migrate.ts`'s `ensureDatabaseExists()` (connects to `master`,
creates the target database if missing, runs before every `db:migrate`) -
this is why a completely fresh `docker compose up` now works unattended;
before Phase 12, nothing in the app or the compose stack ever created the
database, so this always failed on a brand-new server (Docker or otherwise)
until someone created it by hand.

**Frontend container's own `HEALTHCHECK` fails with "Connection refused"
even though the app works fine from the host browser.** Two independent Next
16 standalone-server + Alpine quirks, both found by actually running the
container:
1. Docker sets a `HOSTNAME` environment variable (the container id) in every
   container by default. The Next.js standalone `server.js` binds to
   whatever `HOSTNAME` resolves to instead of all interfaces if it's set -
   so the server ends up listening only on the container's own Docker-network
   IP. External access still works (Docker's port-publishing delivers traffic
   to that same IP), but anything using loopback from *inside* the container
   gets refused. Fixed with `ENV HOSTNAME=0.0.0.0` in `docker/frontend.Dockerfile`.
2. Even after that, `wget http://localhost:PORT/...` still failed while
   `http://127.0.0.1:PORT/...` worked - this Alpine image's `wget` resolves
   `localhost` to `::1` (IPv6) first, and the server's `0.0.0.0` bind is
   IPv4-only. Both Dockerfiles' `HEALTHCHECK` now use `127.0.0.1` explicitly
   rather than `localhost`, sidestepping the DNS ordering question entirely.

**`docker compose exec backend npm run db:migrate --workspace=backend` fails
with `npm error No workspaces found`.** The running container only has
`backend/`'s own `package.json` (the runtime image never copies the root
one), so `--workspace=backend` has nothing to resolve against inside it -
that flag is only meaningful from the monorepo root. Inside the container,
either drop the flag (`npm run db:migrate`) or, since the same script's
`tsx --env-file=.env ...` also fails there (no `.env` file exists in the
container; the real environment is already injected by compose), call the
compiled entrypoint directly: `node dist/db/migrateCli.js up` - see
`documentation/deployment.md`.
