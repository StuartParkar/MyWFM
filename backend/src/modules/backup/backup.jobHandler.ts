import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerJobHandler } from "../jobs/jobQueue.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** backend/src/modules/backup -> repo root. */
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BACKUP_SCRIPT = path.join(REPO_ROOT, "scripts", "backup-mywfm.sh");

export interface BackupJobResult {
  outDir: string;
  manifest: unknown;
  logTail: string;
}

/**
 * Runs the real scripts/backup-mywfm.sh (documentation/backup-restore.md) via
 * the background job queue - safe to trigger from the web because a backup
 * is purely additive (a new directory/zip) and never touches live state, per
 * system.BackgroundJob's own original purpose comment (migration 0003).
 * Restore is deliberately NOT automated the same way - see backup.routes.ts.
 */
export async function runBackup(): Promise<BackupJobResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(REPO_ROOT, "backups", `mywfm-backup-${timestamp}`);

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(BACKUP_SCRIPT, [outDir], { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 }));
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    throw new Error(`scripts/backup-mywfm.sh failed: ${err instanceof Error ? err.message : String(err)}${stderr ? `\n${stderr}` : ""}`);
  }

  const manifest: unknown = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
  const logTail = stdout.trim().split("\n").slice(-15).join("\n");
  return { outDir, manifest, logTail };
}

export function registerBackupJobHandler(): void {
  registerJobHandler("RUN_BACKUP", () => runBackup());
}
