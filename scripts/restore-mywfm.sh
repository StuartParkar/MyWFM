#!/usr/bin/env bash
# Restores a backup produced by backup-mywfm.sh onto a (possibly brand new)
# machine. See documentation/backup-restore.md for the full walkthrough.
#
# Usage: scripts/restore-mywfm.sh <backup-directory-or-zip> [target-directory]
set -euo pipefail

SOURCE="${1:?Usage: restore-mywfm.sh <backup-directory-or-zip> [target-directory]}"
TARGET="${2:-$(pwd)/mywfm-restored}"

log() { echo "==> $*"; }

WORK_DIR="$SOURCE"
if [[ "$SOURCE" == *.zip ]]; then
  log "1/10 Prerequisites: unzip, node, npm, SQL Server reachable from this machine"
  command -v unzip >/dev/null 2>&1 || { echo "unzip is required to restore from a .zip" >&2; exit 1; }
  WORK_DIR=$(mktemp -d)
  unzip -q "$SOURCE" -d "$WORK_DIR"
  WORK_DIR="$WORK_DIR/$(basename "$SOURCE" .zip)"
else
  log "1/10 Prerequisites: node, npm, SQL Server reachable from this machine"
fi

log "2/10 Validating backup manifest"
MANIFEST="$WORK_DIR/manifest.json"
[ -f "$MANIFEST" ] || { echo "No manifest.json found at $MANIFEST - is this a real backup?" >&2; exit 1; }
node -e "const m = JSON.parse(require('fs').readFileSync('$MANIFEST', 'utf8')); console.log('    backup from ' + m.createdAtUtc + ', git ' + m.gitCommit + ', ' + m.migrationFileCount + ' migration file(s), SQL .bak included: ' + m.sqlServerBakIncluded);"

log "3/10 Restoring application source into $TARGET"
mkdir -p "$TARGET"
for pkg in shared backend frontend database deployment documentation config; do
  [ -d "$WORK_DIR/$pkg" ] && cp -r "$WORK_DIR/$pkg" "$TARGET/$pkg"
done
cp "$WORK_DIR"/package.json "$WORK_DIR"/package-lock.json "$WORK_DIR"/tsconfig.base.json "$TARGET/" 2>/dev/null || true
[ -d "$TARGET/deployment/docker" ] && cp -r "$TARGET/deployment/docker" "$TARGET/docker"
[ -f "$TARGET/deployment/docker-compose.yml" ] && cp "$TARGET/deployment/docker-compose.yml" "$TARGET/docker-compose.yml"
[ -d "$TARGET/deployment/scripts" ] && cp -r "$TARGET/deployment/scripts" "$TARGET/scripts"
rm -rf "$TARGET/deployment"

log "4/10 Environment configuration: copy the .env.example files this restore included and fill in real values"
find "$TARGET" -name '.env.example' | while read -r example; do
  target_env="${example%.example}"
  [ -f "$target_env" ] || cp "$example" "$target_env"
  echo "    edit $target_env"
done

log "5/10 SQL Server setup: ensure a reachable SQL Server instance exists (docker compose up -d db, or your own)"

if [ "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MANIFEST','utf8')).sqlServerBakIncluded)")" = "true" ]; then
  log "6/10 Database restore: a live .bak was recorded on the source SQL Server host at backup time."
  log "     It is NOT inside this archive (SQL Server writes .bak files on its own host/container filesystem)."
  log "     Locate it there and run: RESTORE DATABASE [<name>] FROM DISK = N'<path>' WITH REPLACE;"
else
  log "6/10 Database restore: no live .bak was captured - rebuilding schema from source instead (next step covers this)."
fi

log "7/10 Migrations: from $TARGET, run: npm install && npm run db:migrate --workspace=backend"
log "8/10 Backend setup: fill in $TARGET/backend/.env, then npm run db:seed --workspace=backend"
log "9/10 Frontend setup: fill in $TARGET/frontend/.env.local"
log "10/10 Startup and validation: npm run dev (from $TARGET), then check GET /api/system-health"

log "File restore complete at $TARGET. Steps 6-10 above need to be run manually against a real SQL Server."
