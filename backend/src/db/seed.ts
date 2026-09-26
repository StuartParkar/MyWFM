import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATABASE_ROOT, splitSqlBatches } from "./migrate.js";
import { getPool, closePool, sql } from "./pool.js";
import { logger } from "../logger/logger.js";

/**
 * Applies every `.sql` file directly under database/seed-data/ (NOT its `dev/`
 * subfolder - that is demo data, applied separately by scripts/seedDev.ts).
 * These files are real reference data (roles, permissions, default
 * configuration) the app cannot run without, in any environment, so they are
 * re-applied every time this script runs rather than tracked like a migration.
 */
async function main(): Promise<void> {
  const seedDir = path.join(DATABASE_ROOT, "seed-data");
  const files = readdirSync(seedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const pool = await getPool();
  for (const filename of files) {
    const text = readFileSync(path.join(seedDir, filename), "utf8");
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const batch of splitSqlBatches(text)) {
        await new sql.Request(transaction).batch(batch);
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
    logger.info({ filename }, "Applied seed data file");
  }
  logger.info({ count: files.length }, "Seed data up to date");
}

main()
  .catch((err) => {
    logger.critical({ err }, "Seeding failed");
    process.exitCode = 1;
  })
  .finally(() => closePool());
