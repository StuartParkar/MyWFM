import { applyMigrations, applyProgrammabilityObjects, getMigrationStatus } from "./migrate.js";
import { closePool } from "./pool.js";
import { logger } from "../logger/logger.js";
import { userInfo } from "node:os";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";

  if (command === "status") {
    const status = await getMigrationStatus();
    if (status.length === 0) {
      logger.info({}, "No migration files found.");
    }
    for (const entry of status) {
      logger.info({ filename: entry.filename, status: entry.status }, entry.filename);
    }
    const pending = status.filter((s) => s.status !== "APPLIED");
    if (pending.length > 0) {
      logger.warn({ count: pending.length }, "There are pending or mismatched migrations");
      process.exitCode = 1;
    }
    return;
  }

  if (command === "up") {
    const appliedBy = `cli:${userInfo().username}`;
    const { applied } = await applyMigrations(appliedBy);
    logger.info({ count: applied.length, applied }, "Migrations up to date");
    const { applied: programmability } = await applyProgrammabilityObjects();
    logger.info({ count: programmability.length }, "Programmability objects applied");
    return;
  }

  throw new Error(`Unknown command "${command}". Use "up" or "status".`);
}

main()
  .catch((err) => {
    logger.critical({ err }, "Migration command failed");
    process.exitCode = 1;
  })
  .finally(() => closePool());
