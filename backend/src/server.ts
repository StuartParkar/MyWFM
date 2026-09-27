import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { loadAppConfig } from "./config/appConfig.js";
import { checkRbacSync } from "./config/rbacSync.js";
import { closePool, getPool } from "./db/pool.js";
import { getMigrationStatus } from "./db/migrate.js";
import { logger } from "./logger/logger.js";
import { startJobWorker } from "./modules/jobs/jobQueue.js";
import { startHealthSnapshotSampler } from "./modules/health/healthSnapshotSampler.js";
import { registerBackupJobHandler } from "./modules/backup/backup.jobHandler.js";

async function bootstrapDatabaseDependentState(): Promise<void> {
  try {
    await getPool();
  } catch (err) {
    logger.critical(
      { err },
      "Could not connect to SQL Server at boot. The API will keep running in a degraded state - " +
        "auth and every DB-backed route will fail until connectivity is restored. " +
        "See documentation/deployment.md if this is unexpected.",
    );
    return;
  }

  await loadAppConfig();
  await checkRbacSync();

  try {
    const status = await getMigrationStatus();
    const pending = status.filter((s) => s.status !== "APPLIED");
    if (pending.length > 0) {
      logger.warn(
        { pending: pending.map((p) => `${p.filename} (${p.status})`) },
        "Pending or mismatched database migrations detected. Run `npm run db:migrate --workspace=backend`.",
      );
    } else {
      logger.info({ count: status.length }, "Database schema is up to date");
    }
  } catch (err) {
    logger.warn({ err }, "Could not check migration status");
  }
}

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Universal MyWFM backend listening");
  });
  // headersTimeout must exceed keepAliveTimeout (Node's own requirement) to avoid
  // a race that can drop legitimate keep-alive connections under load.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await bootstrapDatabaseDependentState();
  registerBackupJobHandler();
  const jobWorker = startJobWorker();
  const healthSampler = startHealthSnapshotSampler();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    jobWorker.stop();
    healthSampler.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.critical({ err }, "Fatal error during startup");
  process.exit(1);
});
