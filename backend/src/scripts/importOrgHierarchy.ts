import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool } from "../db/pool.js";
import { logger } from "../logger/logger.js";
import { importEmployeeHierarchy } from "../modules/imports/orgHierarchyImporter.js";

/**
 * CLI convenience wrapper around importEmployeeHierarchy() for the fixed
 * sample path - loads the real org-hierarchy sample the business owner
 * provided in chat. Runs through the same Import Center pipeline
 * (import.ImportRun / import.DataQualityIssue) as an upload through the
 * Admin > Import Center screen would (Phase 3) - see
 * backend/src/modules/imports/orgHierarchyImporter.ts for the actual logic
 * and imports/samples/master-data/README.md for the data's provenance.
 *
 * Usage: npm run import:org-hierarchy --workspace=backend
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSV_PATH = path.resolve(__dirname, "../../../imports/samples/master-data/employee-org-hierarchy-2026-09-26.tsv");

async function main(): Promise<void> {
  const text = readFileSync(TSV_PATH, "utf8");
  const result = await importEmployeeHierarchy(text, { fileName: path.basename(TSV_PATH), uploadedByUserId: null });
  logger.info(result, `${result.importCode}: complete`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main()
    .catch((err) => {
      logger.critical({ err }, "importOrgHierarchy failed");
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
