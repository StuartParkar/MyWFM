import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, sql } from "./pool.js";
import { env } from "../config/env.js";
import { logger } from "../logger/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATABASE_ROOT = path.resolve(__dirname, "../../../database");
export const MIGRATIONS_DIR = path.join(DATABASE_ROOT, "migrations");
const PROGRAMMABILITY_DIRS = ["stored-procedures", "views", "functions", "triggers"];

/**
 * Splits a .sql file's text into batches on `GO` separator lines. `GO` is a
 * SQLCMD/SSMS convention the mssql driver does not understand natively, so we
 * split it out ourselves. A line counts as a separator only if, once trimmed,
 * it is exactly "GO" (case-insensitive) - this deliberately will not match
 * "GO" appearing as part of a longer line/string literal.
 */
export function splitSqlBatches(sqlText: string): string[] {
  const lines = sqlText.split(/\r?\n/);
  const batches: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^\s*GO\s*$/i.test(line)) {
      batches.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  batches.push(current.join("\n"));

  return batches.map((b) => b.trim()).filter((b) => b.length > 0);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function listSqlFilesRecursive(dir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSqlFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".sql")) {
      files.push(full);
    }
  }
  return files.sort();
}

async function ensureSchemaMigrationTable(): Promise<void> {
  const pool = await getPool();
  await pool.request().batch(`IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'system') EXEC('CREATE SCHEMA [system]');`);
  await pool.request().batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'system' AND t.name = 'SchemaMigration')
    BEGIN
        CREATE TABLE [system].SchemaMigration
        (
            MigrationId   INT IDENTITY(1,1) CONSTRAINT PK_SchemaMigration PRIMARY KEY,
            Filename      NVARCHAR(260) NOT NULL CONSTRAINT UQ_SchemaMigration_Filename UNIQUE,
            Checksum      CHAR(64) NOT NULL,
            AppliedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaMigration_AppliedAt DEFAULT (SYSUTCDATETIME()),
            AppliedBy     NVARCHAR(200) NOT NULL,
            ExecutionMs   INT NOT NULL
        );
    END
  `);
}

const SAFE_DB_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Connecting straight to SQL_SERVER_DATABASE when it doesn't exist yet
 * produces a misleading "Login failed for user" error (SQL Server's login
 * response for an unknown initial catalog), not a clear "database does not
 * exist" - found by actually running this against a fresh SQL Server
 * container, where nothing had ever created UniversalMyWFM. Connects to
 * master on its own short-lived pool (getPool()'s shared pool is locked to
 * SQL_SERVER_DATABASE) so `db:migrate` works unattended on a brand-new server.
 */
async function ensureDatabaseExists(): Promise<void> {
  if (!SAFE_DB_NAME.test(env.SQL_SERVER_DATABASE)) {
    throw new Error(`Refusing to use unsafe database name "${env.SQL_SERVER_DATABASE}"`);
  }

  const masterPool = await new sql.ConnectionPool({
    server: env.SQL_SERVER_HOST,
    port: env.SQL_SERVER_PORT,
    database: "master",
    user: env.SQL_SERVER_USER,
    password: env.SQL_SERVER_PASSWORD,
    options: {
      encrypt: env.SQL_SERVER_ENCRYPT,
      trustServerCertificate: env.SQL_SERVER_TRUST_SERVER_CERTIFICATE,
    },
  }).connect();

  try {
    const result = await masterPool
      .request()
      .input("DbName", sql.NVarChar(128), env.SQL_SERVER_DATABASE)
      .query("SELECT database_id FROM sys.databases WHERE name = @DbName");

    if (result.recordset.length === 0) {
      logger.info({ database: env.SQL_SERVER_DATABASE }, "Target database does not exist - creating it");
      await masterPool.request().batch(`CREATE DATABASE [${env.SQL_SERVER_DATABASE}]`);
    }
  } finally {
    await masterPool.close();
  }
}

interface AppliedRow {
  Filename: string;
  Checksum: string;
}

async function getAppliedMigrations(): Promise<Map<string, string>> {
  const pool = await getPool();
  const result = await pool.request().query<AppliedRow>("SELECT Filename, Checksum FROM [system].SchemaMigration");
  return new Map(result.recordset.map((row) => [row.Filename, row.Checksum]));
}

export interface MigrationStatusEntry {
  filename: string;
  status: "APPLIED" | "PENDING" | "CHECKSUM_MISMATCH";
}

export async function getMigrationStatus(): Promise<MigrationStatusEntry[]> {
  await ensureSchemaMigrationTable();
  const applied = await getAppliedMigrations();
  const files = listSqlFilesRecursive(MIGRATIONS_DIR);

  return files.map((file) => {
    const filename = path.basename(file);
    const checksum = sha256(readFileSync(file, "utf8"));
    const appliedChecksum = applied.get(filename);
    if (appliedChecksum === undefined) return { filename, status: "PENDING" as const };
    if (appliedChecksum !== checksum) return { filename, status: "CHECKSUM_MISMATCH" as const };
    return { filename, status: "APPLIED" as const };
  });
}

async function runBatchesInTransaction(batches: string[]): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const batch of batches) {
      await new sql.Request(transaction).batch(batch);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/** Applies pending numbered migrations, in filename order. Throws on checksum drift on an already-applied file rather than silently re-running or ignoring it. */
export async function applyMigrations(appliedBy: string): Promise<{ applied: string[] }> {
  await ensureDatabaseExists();
  await ensureSchemaMigrationTable();
  const applied = await getAppliedMigrations();
  const files = listSqlFilesRecursive(MIGRATIONS_DIR);
  const appliedNow: string[] = [];

  for (const file of files) {
    const filename = path.basename(file);
    const text = readFileSync(file, "utf8");
    const checksum = sha256(text);
    const existingChecksum = applied.get(filename);

    if (existingChecksum !== undefined) {
      if (existingChecksum !== checksum) {
        throw new Error(
          `Migration "${filename}" was already applied with a different checksum. ` +
            "Applied migrations must never be edited in place - create a new migration instead.",
        );
      }
      continue;
    }

    const start = Date.now();
    logger.info({ filename }, "Applying migration");
    await runBatchesInTransaction(splitSqlBatches(text));
    const executionMs = Date.now() - start;

    const pool = await getPool();
    await pool
      .request()
      .input("Filename", sql.NVarChar(260), filename)
      .input("Checksum", sql.Char(64), checksum)
      .input("AppliedBy", sql.NVarChar(200), appliedBy)
      .input("ExecutionMs", sql.Int, executionMs)
      .query(
        "INSERT INTO [system].SchemaMigration (Filename, Checksum, AppliedBy, ExecutionMs) VALUES (@Filename, @Checksum, @AppliedBy, @ExecutionMs)",
      );

    appliedNow.push(filename);
    logger.info({ filename, executionMs }, "Migration applied");
  }

  return { applied: appliedNow };
}

/** Re-applies every CREATE OR ALTER programmability object. Idempotent by construction, so nothing is tracked. */
export async function applyProgrammabilityObjects(): Promise<{ applied: string[] }> {
  const appliedNow: string[] = [];
  for (const dir of PROGRAMMABILITY_DIRS) {
    const files = listSqlFilesRecursive(path.join(DATABASE_ROOT, dir));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const batches = splitSqlBatches(text);
      if (batches.length === 0) continue;
      await runBatchesInTransaction(batches);
      appliedNow.push(path.relative(DATABASE_ROOT, file));
      logger.info({ file: path.relative(DATABASE_ROOT, file) }, "Applied programmability object");
    }
  }
  return { applied: appliedNow };
}
