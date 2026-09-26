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
docker compose exec backend npm run db:migrate --workspace=backend
docker compose exec backend npm run db:seed --workspace=backend
```

Services: `db` (SQL Server 2022, healthchecked before `backend` starts),
`backend` (Express API, port 4000), `frontend` (Next.js standalone build,
port 3000, proxies `/api/*` to `backend` inside the compose network).

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
