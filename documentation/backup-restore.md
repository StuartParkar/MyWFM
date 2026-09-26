# Backup & Restore

## Backup

```bash
scripts/backup-mywfm.sh [output-directory]     # macOS/Linux - tested in this repo's own dev sandbox
scripts/backup-mywfm.ps1 [-OutputDirectory ...] # Windows - review before first use (see note below)
```

What it captures: application source (`shared`, `backend`, `frontend`,
excluding `node_modules`/build output/`.env*`), the full `database/` folder
(migrations, stored procedures, views, functions, triggers, indexes, seed
data), `docker/` + `docker-compose.yml` + `scripts/`, `documentation/`,
`config/`, and root config files. **Never** copies an actual `.env` file -
only `.env.example`.

If `sqlcmd` is on `PATH` and `SQL_SERVER_HOST`/`SQL_SERVER_PASSWORD` are set,
it also attempts a live `BACKUP DATABASE` (best effort - logs and continues
if it fails, since the source/schema backup is independent of it). The
resulting `.bak` is written on the **SQL Server host/container's own
filesystem**, not necessarily reachable from wherever the script ran - the
script tells you the path it used.

Every backup ends with **validation**: `manifest.json` must parse, and its
recorded migration-file count must match what's actually in the archive. The
script exits non-zero if either check fails, per build spec section 83.

## Restore

```bash
scripts/restore-mywfm.sh <backup.zip-or-directory> [target-directory]
scripts/restore-mywfm.ps1 -Source <...> [-TargetDirectory <...>]
```

Walks the 10 steps from build spec section 82: prerequisites, manifest
validation, source restore, environment file setup, SQL Server setup,
database restore, migrations, backend setup, frontend setup, startup. Steps
1-4 are fully automated; steps 5-10 need a real, reachable SQL Server and are
printed as explicit instructions rather than guessed at - a script silently
"succeeding" at a database restore it can't actually verify would be worse
than telling you exactly what to run.

## A note on the PowerShell scripts

`backup-mywfm.ps1` and `restore-mywfm.ps1` implement the identical steps as
their tested `.sh` counterparts, but this project's own development sandbox
had no Windows/PowerShell host to run them against. Treat them as
carefully-written but **unverified** until exercised on a real Windows
machine - if you hit an issue, the `.sh` version is the one to diff against
for the intended behavior.
