#!/usr/bin/env bash
# First-time setup for local development on macOS/Linux. Idempotent - safe to
# re-run. See documentation/deployment.md for the full walkthrough and the
# Windows/PowerShell equivalent.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> Checking Node.js version"
node_version=$(node --version)
echo "    $node_version"
if ! node -e 'process.exit(process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then
  echo "Node.js 20.9+ is required (see node_modules/next/dist/docs/... upgrading guide). Found: $node_version" >&2
  exit 1
fi

copy_env_if_missing() {
  local example="$1" target="$2"
  if [ ! -f "$target" ]; then
    cp "$example" "$target"
    echo "    created $target from $example - edit it before running the app"
  else
    echo "    $target already exists, leaving it alone"
  fi
}

echo "==> Setting up environment files"
copy_env_if_missing ".env.example" ".env"
copy_env_if_missing "backend/.env.example" "backend/.env"
copy_env_if_missing "frontend/.env.example" "frontend/.env.local"

echo "==> Installing dependencies (npm workspaces: shared, backend, frontend)"
npm install

cat <<'EOF'

==> Setup complete. Next steps:

  1. Edit backend/.env with real SQL Server connection details and secrets
     (or run `docker compose up -d db` to use the bundled SQL Server container
     with the password from your root .env).
  2. npm run db:migrate --workspace=backend
  3. npm run db:seed --workspace=backend        # required reference data
  4. npm run db:seed:dev --workspace=backend     # DEMO DATA admin login, optional
  5. npm run dev                                 # starts backend + frontend

EOF
