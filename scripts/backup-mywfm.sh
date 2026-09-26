#!/usr/bin/env bash
# Full project backup: application source, database (schema/migrations/
# programmability/seed-data), deployment files, documentation, and (best
# effort) a live SQL Server .bak. See documentation/backup-restore.md.
#
# Usage: scripts/backup-mywfm.sh [output-directory]
# Env (optional, for the live SQL Server .bak step):
#   SQL_SERVER_HOST, SQL_SERVER_PORT, SQL_SERVER_DATABASE, SQL_SERVER_USER,
#   SQL_SERVER_PASSWORD, SQL_SERVER_BACKUP_PATH (a path the SQL Server
#   *process* can write to - not necessarily the same filesystem as this script)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="${1:-backups/mywfm-backup-$TIMESTAMP}"
mkdir -p "$OUT_DIR"

log() { echo "==> $*"; }

copy_tree() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude node_modules --exclude dist --exclude .next --exclude '*.tsbuildinfo' \
      --exclude .env --exclude .env.local --exclude .env.*.local "$src/" "$dst/"
  else
    cp -r "$src/." "$dst/"
    rm -rf "$dst/node_modules" "$dst/dist" "$dst/.next"
    find "$dst" -name '*.tsbuildinfo' -delete
    rm -f "$dst/.env" "$dst"/.env.local "$dst"/.env.*.local
  fi
}

log "Backing up Universal MyWFM to $OUT_DIR"

log "Application source (shared, backend, frontend)"
for pkg in shared backend frontend; do
  copy_tree "$pkg" "$OUT_DIR/$pkg"
done

log "Database (schema, migrations, stored procedures, views, functions, triggers, indexes, seed data)"
copy_tree database "$OUT_DIR/database"

log "Deployment files (Docker, docker-compose, scripts)"
mkdir -p "$OUT_DIR/deployment"
copy_tree docker "$OUT_DIR/deployment/docker"
cp docker-compose.yml "$OUT_DIR/deployment/docker-compose.yml"
copy_tree scripts "$OUT_DIR/deployment/scripts"

if [ -d documentation ]; then
  log "Documentation"
  copy_tree documentation "$OUT_DIR/documentation"
fi

log "Root configuration (no secrets - .env.example only)"
cp package.json package-lock.json tsconfig.base.json "$OUT_DIR/" 2>/dev/null || true
cp .env.example "$OUT_DIR/.env.example" 2>/dev/null || true
[ -d config ] && copy_tree config "$OUT_DIR/config"

SQL_BAK_INCLUDED=false
if command -v sqlcmd >/dev/null 2>&1 && [ -n "${SQL_SERVER_HOST:-}" ] && [ -n "${SQL_SERVER_PASSWORD:-}" ]; then
  log "Attempting live SQL Server .bak (best effort)"
  BACKUP_PATH="${SQL_SERVER_BACKUP_PATH:-/var/opt/mssql/backup/$(basename "$OUT_DIR").bak}"
  DB_NAME="${SQL_SERVER_DATABASE:-UniversalMyWFM}"
  if sqlcmd -S "${SQL_SERVER_HOST},${SQL_SERVER_PORT:-1433}" -U "${SQL_SERVER_USER:-sa}" -P "$SQL_SERVER_PASSWORD" -C \
      -Q "BACKUP DATABASE [$DB_NAME] TO DISK = N'$BACKUP_PATH' WITH INIT, COMPRESSION;" 2>"$OUT_DIR/sql-backup.log"; then
    log "SQL Server BACKUP DATABASE succeeded -> $BACKUP_PATH (on the SQL Server host/container, not necessarily this machine)"
    SQL_BAK_INCLUDED=true
  else
    log "SQL Server BACKUP DATABASE failed - see $OUT_DIR/sql-backup.log. Source/schema backup above is unaffected."
  fi
else
  log "sqlcmd not available or SQL_SERVER_HOST/SQL_SERVER_PASSWORD unset - skipping live SQL Server .bak"
  log "(source, schema, migrations and seed data are still fully backed up)"
fi

GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown)
MIGRATION_COUNT=$(find database/migrations -name '*.sql' | wc -l | tr -d ' ')
cat > "$OUT_DIR/manifest.json" <<JSON
{
  "createdAtUtc": "$TIMESTAMP",
  "gitCommit": "$GIT_COMMIT",
  "components": ["shared", "backend", "frontend", "database", "deployment", "documentation", "config"],
  "migrationFileCount": $MIGRATION_COUNT,
  "sqlServerBakIncluded": $SQL_BAK_INCLUDED
}
JSON
log "Manifest written to $OUT_DIR/manifest.json"

log "Validating backup"
node -e "JSON.parse(require('fs').readFileSync('$OUT_DIR/manifest.json', 'utf8'))" \
  && log "  manifest.json parses OK" \
  || { echo "VALIDATION FAILED: manifest.json is not valid JSON" >&2; exit 1; }

ACTUAL_MIGRATIONS=$(find "$OUT_DIR/database/migrations" -name '*.sql' | wc -l | tr -d ' ')
if [ "$ACTUAL_MIGRATIONS" != "$MIGRATION_COUNT" ]; then
  echo "VALIDATION FAILED: manifest says $MIGRATION_COUNT migration files, backup contains $ACTUAL_MIGRATIONS" >&2
  exit 1
fi
log "  migration file count matches ($MIGRATION_COUNT)"

if command -v zip >/dev/null 2>&1; then
  ZIP_FILE="${OUT_DIR}.zip"
  (cd "$(dirname "$OUT_DIR")" && zip -rq "$(basename "$ZIP_FILE")" "$(basename "$OUT_DIR")")
  unzip -tq "$ZIP_FILE" >/dev/null && log "  archive integrity OK -> $ZIP_FILE"
else
  log "  'zip' not installed - leaving the backup as an uncompressed directory at $OUT_DIR"
fi

log "Backup complete and validated: $OUT_DIR"
