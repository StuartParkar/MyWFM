# Deployment

## Local development (no Docker)

```bash
scripts/dev-setup.sh   # or, on Windows, follow the same steps by hand for now
npm run db:migrate --workspace=backend
npm run db:seed --workspace=backend
npm run db:seed:dev --workspace=backend   # optional: DEMO DATA admin@example.com
npm run dev                                # backend on :4000, frontend on :3000
```

Requires a reachable SQL Server instance - either your own, or
`docker compose up -d db` using this repo's `docker-compose.yml` (the rest of
the environment can still run outside Docker).

## Docker Compose (full stack)

```bash
cp .env.example .env   # fill in a real SQL_SERVER_PASSWORD, JWT secrets
docker compose up -d --build
docker compose exec backend node dist/db/migrateCli.js up
docker compose exec backend node dist/db/seed.js
docker compose exec backend node dist/scripts/createAdmin.js --email you@company.com --password 'Str0ngPass!'
```

Note the exact commands above, not `npm run db:migrate --workspace=backend`
as you'd run locally: the runtime image only ships `backend/`'s own
`package.json` (no root workspace config, so `--workspace` has nothing to
resolve), and its `db:migrate`/`db:seed` npm scripts hard-code
`tsx --env-file=.env ...`, but there's no `.env` file inside the
container - compose already injects the real environment directly. Calling
the compiled `dist/` entrypoints directly sidesteps both.

Services: `db` (SQL Server 2022, healthchecked before `backend` starts),
`backend` (Express API, port 4000), `frontend` (Next.js standalone build,
port 3000, proxies `/api/*` to `backend` inside the compose network).
`db:migrate` creates the target database itself if it doesn't exist yet
(connects to `master` first) - a fresh `docker compose up` has nothing else
that would create it.

If port 1433 is already taken on the host (e.g. a native SQL Server
install), set `SQL_SERVER_PORT` in the root `.env` to something else before
starting - see `documentation/troubleshooting.md`.

**Known gap, not fixed this phase:** `backend` connects to `db` as `sa`
(`docker-compose.yml`), not a dedicated least-privilege login the way
`documentation/security.md` otherwise expects. Verified end-to-end for the
first time in Phase 12 as-is; scoping it down to its own login (mirroring
how `create-admin` already keeps app credentials separate from the database
credential) is real follow-up work, not done here to avoid changing the
compose stack's shape while first verifying it actually runs at all.

## Production (bare metal / VM)

1. Provision SQL Server yourself (this project never containerizes SQL
   Server for production - `docker/`'s `db` service is for local dev/CI only).
2. `npm install && npm run build` (builds `shared`, then `backend`, then `frontend`).
3. `npm run db:migrate --workspace=backend` (never `db:seed:dev` in production).
4. `npm run create-admin --workspace=backend` for the first real login.
5. Run `backend` with `npm start --workspace=backend` (reads `.env` via
   Node's `--env-file`) and `frontend` with `npm start --workspace=frontend`,
   behind your own reverse proxy/process manager.

## Portability (build spec section 62)

Nothing in this codebase hard-codes a machine name, local path, username, or
IP. Every environment-specific value is a `.env` variable
(`documentation/configuration.md`), and `database/` migrations are pure T-SQL
with no assumptions about drive letters or server names. A fresh clone plus a
restored backup (`documentation/backup-restore.md`) should stand up on any
machine that has Node.js 20.9+, npm, and a reachable SQL Server.
