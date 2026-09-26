#requires -Version 5.1
<#
.SYNOPSIS
  Full project backup: application source, database (schema/migrations/
  programmability/seed-data), deployment files, documentation, and (best
  effort) a live SQL Server .bak. See documentation/backup-restore.md.

.PARAMETER OutputDirectory
  Where to write the backup. Defaults to backups/mywfm-backup-<timestamp>.

.PARAMETER SqlServerHost / SqlServerPort / SqlServerDatabase / SqlServerUser / SqlServerPassword
  Optional - if supplied (and sqlcmd is on PATH), attempts a live
  BACKUP DATABASE in addition to the source/schema backup.

.NOTES
  This script has not been run in this project's own development sandbox
  (no Windows/PowerShell host was available there) - review it before first
  use in your environment. scripts/backup-mywfm.sh is the tested Bash
  equivalent and implements the identical steps.
#>
param(
    [string]$OutputDirectory,
    [string]$SqlServerHost = $env:SQL_SERVER_HOST,
    [int]$SqlServerPort = $(if ($env:SQL_SERVER_PORT) { [int]$env:SQL_SERVER_PORT } else { 1433 }),
    [string]$SqlServerDatabase = $(if ($env:SQL_SERVER_DATABASE) { $env:SQL_SERVER_DATABASE } else { "UniversalMyWFM" }),
    [string]$SqlServerUser = $(if ($env:SQL_SERVER_USER) { $env:SQL_SERVER_USER } else { "sa" }),
    [string]$SqlServerPassword = $env:SQL_SERVER_PASSWORD,
    [string]$SqlServerBackupPath = $env:SQL_SERVER_BACKUP_PATH
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
if (-not $OutputDirectory) { $OutputDirectory = "backups/mywfm-backup-$Timestamp" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Write-Step([string]$Message) { Write-Host "==> $Message" }

function Copy-Tree([string]$Src, [string]$Dst) {
    New-Item -ItemType Directory -Force -Path $Dst | Out-Null
    robocopy $Src $Dst /E /XD node_modules dist .next /XF "*.tsbuildinfo" ".env" ".env.local" ".env.*.local" | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying $Src -> $Dst (exit $LASTEXITCODE)" }
}

Write-Step "Backing up Universal MyWFM to $OutputDirectory"

Write-Step "Application source (shared, backend, frontend)"
foreach ($pkg in @("shared", "backend", "frontend")) {
    Copy-Tree $pkg (Join-Path $OutputDirectory $pkg)
}

Write-Step "Database (schema, migrations, stored procedures, views, functions, triggers, indexes, seed data)"
Copy-Tree "database" (Join-Path $OutputDirectory "database")

Write-Step "Deployment files (Docker, docker-compose, scripts)"
$deploymentDir = Join-Path $OutputDirectory "deployment"
New-Item -ItemType Directory -Force -Path $deploymentDir | Out-Null
Copy-Tree "docker" (Join-Path $deploymentDir "docker")
Copy-Item "docker-compose.yml" (Join-Path $deploymentDir "docker-compose.yml")
Copy-Tree "scripts" (Join-Path $deploymentDir "scripts")

if (Test-Path "documentation") {
    Write-Step "Documentation"
    Copy-Tree "documentation" (Join-Path $OutputDirectory "documentation")
}

Write-Step "Root configuration (no secrets - .env.example only)"
foreach ($f in @("package.json", "package-lock.json", "tsconfig.base.json", ".env.example")) {
    if (Test-Path $f) { Copy-Item $f (Join-Path $OutputDirectory $f) }
}
if (Test-Path "config") { Copy-Tree "config" (Join-Path $OutputDirectory "config") }

$sqlBakIncluded = $false
$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if ($sqlcmd -and $SqlServerHost -and $SqlServerPassword) {
    Write-Step "Attempting live SQL Server .bak (best effort)"
    if (-not $SqlServerBackupPath) { $SqlServerBackupPath = "/var/opt/mssql/backup/$(Split-Path $OutputDirectory -Leaf).bak" }
    $logFile = Join-Path $OutputDirectory "sql-backup.log"
    $query = "BACKUP DATABASE [$SqlServerDatabase] TO DISK = N'$SqlServerBackupPath' WITH INIT, COMPRESSION;"
    & sqlcmd -S "$SqlServerHost,$SqlServerPort" -U $SqlServerUser -P $SqlServerPassword -C -Q $query 2> $logFile
    if ($LASTEXITCODE -eq 0) {
        Write-Step "SQL Server BACKUP DATABASE succeeded -> $SqlServerBackupPath (on the SQL Server host/container, not necessarily this machine)"
        $sqlBakIncluded = $true
    } else {
        Write-Step "SQL Server BACKUP DATABASE failed - see $logFile. Source/schema backup above is unaffected."
    }
} else {
    Write-Step "sqlcmd not available or SqlServerHost/SqlServerPassword unset - skipping live SQL Server .bak"
    Write-Step "(source, schema, migrations and seed data are still fully backed up)"
}

$gitCommit = try { (git rev-parse HEAD 2>$null) } catch { "unknown" }
if (-not $gitCommit) { $gitCommit = "unknown" }
$migrationCount = (Get-ChildItem "database/migrations" -Filter "*.sql").Count

$manifest = [ordered]@{
    createdAtUtc        = $Timestamp
    gitCommit            = $gitCommit
    components           = @("shared", "backend", "frontend", "database", "deployment", "documentation", "config")
    migrationFileCount   = $migrationCount
    sqlServerBakIncluded = $sqlBakIncluded
}
$manifestPath = Join-Path $OutputDirectory "manifest.json"
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8
Write-Step "Manifest written to $manifestPath"

Write-Step "Validating backup"
$parsed = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Step "  manifest.json parses OK"
$actualMigrations = (Get-ChildItem (Join-Path $OutputDirectory "database/migrations") -Filter "*.sql").Count
if ($actualMigrations -ne $parsed.migrationFileCount) {
    throw "VALIDATION FAILED: manifest says $($parsed.migrationFileCount) migration files, backup contains $actualMigrations"
}
Write-Step "  migration file count matches ($actualMigrations)"

$zipPath = "$OutputDirectory.zip"
Compress-Archive -Path "$OutputDirectory/*" -DestinationPath $zipPath -Force
Write-Step "  archive written -> $zipPath"

Write-Step "Backup complete and validated: $OutputDirectory"
