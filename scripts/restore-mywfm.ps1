#requires -Version 5.1
<#
.SYNOPSIS
  Restores a backup produced by backup-mywfm.ps1 (or backup-mywfm.sh) onto a
  (possibly brand new) Windows machine. See documentation/backup-restore.md.

.PARAMETER Source
  Path to a backup directory or .zip produced by backup-mywfm.

.PARAMETER TargetDirectory
  Where to restore into. Defaults to .\mywfm-restored.

.NOTES
  This script has not been run in this project's own development sandbox
  (no Windows/PowerShell host was available there) - review it before first
  use in your environment. scripts/restore-mywfm.sh is the tested Bash
  equivalent and implements the identical steps.
#>
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$TargetDirectory = (Join-Path (Get-Location) "mywfm-restored")
)

$ErrorActionPreference = "Stop"
function Write-Step([string]$Message) { Write-Host "==> $Message" }

$workDir = $Source
if ($Source -like "*.zip") {
    Write-Step "1/10 Prerequisites: PowerShell 5.1+, node, npm, SQL Server reachable from this machine"
    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    Expand-Archive -Path $Source -DestinationPath $workDir -Force
} else {
    Write-Step "1/10 Prerequisites: node, npm, SQL Server reachable from this machine"
}

Write-Step "2/10 Validating backup manifest"
$manifestPath = Join-Path $workDir "manifest.json"
if (-not (Test-Path $manifestPath)) { throw "No manifest.json found at $manifestPath - is this a real backup?" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "    backup from $($manifest.createdAtUtc), git $($manifest.gitCommit), $($manifest.migrationFileCount) migration file(s), SQL .bak included: $($manifest.sqlServerBakIncluded)"

Write-Step "3/10 Restoring application source into $TargetDirectory"
New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
foreach ($pkg in @("shared", "backend", "frontend", "database", "documentation", "config")) {
    $src = Join-Path $workDir $pkg
    if (Test-Path $src) { Copy-Item $src (Join-Path $TargetDirectory $pkg) -Recurse -Force }
}
foreach ($f in @("package.json", "package-lock.json", "tsconfig.base.json")) {
    $src = Join-Path $workDir $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $TargetDirectory $f) -Force }
}
$deploymentDir = Join-Path $workDir "deployment"
if (Test-Path (Join-Path $deploymentDir "docker")) { Copy-Item (Join-Path $deploymentDir "docker") (Join-Path $TargetDirectory "docker") -Recurse -Force }
if (Test-Path (Join-Path $deploymentDir "docker-compose.yml")) { Copy-Item (Join-Path $deploymentDir "docker-compose.yml") (Join-Path $TargetDirectory "docker-compose.yml") -Force }
if (Test-Path (Join-Path $deploymentDir "scripts")) { Copy-Item (Join-Path $deploymentDir "scripts") (Join-Path $TargetDirectory "scripts") -Recurse -Force }

Write-Step "4/10 Environment configuration: copy the .env.example files this restore included and fill in real values"
Get-ChildItem -Path $TargetDirectory -Filter ".env.example" -Recurse | ForEach-Object {
    $targetEnv = $_.FullName -replace '\.example$', ''
    if (-not (Test-Path $targetEnv)) { Copy-Item $_.FullName $targetEnv }
    Write-Host "    edit $targetEnv"
}

Write-Step "5/10 SQL Server setup: ensure a reachable SQL Server instance exists (docker compose up -d db, or your own)"

if ($manifest.sqlServerBakIncluded) {
    Write-Step "6/10 Database restore: a live .bak was recorded on the source SQL Server host at backup time."
    Write-Step "     It is NOT inside this archive (SQL Server writes .bak files on its own host/container filesystem)."
    Write-Step "     Locate it there and run: RESTORE DATABASE [<name>] FROM DISK = N'<path>' WITH REPLACE;"
} else {
    Write-Step "6/10 Database restore: no live .bak was captured - rebuilding schema from source instead (next step covers this)."
}

Write-Step "7/10 Migrations: from $TargetDirectory, run: npm install; npm run db:migrate --workspace=backend"
Write-Step "8/10 Backend setup: fill in $TargetDirectory\backend\.env, then npm run db:seed --workspace=backend"
Write-Step "9/10 Frontend setup: fill in $TargetDirectory\frontend\.env.local"
Write-Step "10/10 Startup and validation: npm run dev (from $TargetDirectory), then check GET /api/system-health"

Write-Step "File restore complete at $TargetDirectory. Steps 6-10 above need to be run manually against a real SQL Server."
