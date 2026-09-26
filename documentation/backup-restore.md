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

## Guided backup/restore UI (Admin > System > Backup / Restore, Phase 11)

`/system/backup-restore` (`backup.view`/`backup.execute`) does not
reimplement any of the above - it triggers and displays it:

- **Run Backup Now** enqueues a real `system.BackgroundJob` (`JobType =
  'RUN_BACKUP'`) whose handler (`backup.jobHandler.ts`) runs this exact
  `scripts/backup-mywfm.sh`, waits for it, and reads back the real
  `manifest.json` it produced. Safe to automate from the web because a
  backup is purely additive (a new directory/zip) and never touches live
  state - `system.BackgroundJob`'s own original purpose comment (migration
  `0003_background_jobs.sql`) already named "backups" as an intended use.
  The backup history table (`GET /api/backup/runs`) is just these jobs.
- **Restore is deliberately not automated the same way.** The script itself
  restores onto a *possibly brand-new machine* and only automates steps 1-4
  of the 10 above - a web request handler cannot reinstall its own
  `node_modules`, provision a new SQL Server, or restart itself as a
  different checkout. The guided restore section instead shows the real,
  literal command (`scripts/restore-mywfm.sh <chosen backup's real path>
  <target>`) and the same 10 steps above, for an operator to run themselves.
  There is no "Restore" button that acts on this running system.

## A note on the PowerShell scripts

`backup-mywfm.ps1` and `restore-mywfm.ps1` implement the identical steps as
their tested `.sh` counterparts, but this project's own development sandbox
had no Windows/PowerShell host to run them against. Treat them as
carefully-written but **unverified** until exercised on a real Windows
machine - if you hit an issue, the `.sh` version is the one to diff against
for the intended behavior.
