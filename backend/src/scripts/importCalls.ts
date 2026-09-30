import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closePool } from "../db/pool.js";
import { logger } from "../logger/logger.js";
import { isCallsSource, importCallsFile, type CallsSource } from "../modules/calls/callsImporter.js";

/**
 * CLI convenience wrapper around importCallsFile() for the fixed sample
 * paths - loads the real phone-system sample the business owner provided in
 * chat. Runs through the same Import Center pipeline (import.ImportRun /
 * import.DataQualityIssue) as an upload through the Data > Import Center
 * screen would (Phase 6) - see backend/src/modules/calls/callsImporter.ts
 * for the actual logic and imports/samples/calls/README.md for the data's
 * provenance and mapping.
 *
 * Usage: npm run import:calls --workspace=backend -- <source>
 * where <source> is one of: vonage-queuewise, vonage-company-summary,
 * elevate, ringcentral-calls
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(__dirname, "../../../imports/samples/calls");

const SAMPLE_FILES: Record<CallsSource, string> = {
  "vonage-queuewise": "vonage-queuewise-sample.xlsx",
  "vonage-company-summary": "vonage-company-summary-sample.xlsx",
  elevate: "elevate-sample.xlsx",
  "ringcentral-calls": "ringcentral-calls-sample.xlsx",
};

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source || !isCallsSource(source)) {
    logger.critical(
      { validSources: Object.keys(SAMPLE_FILES) },
      "Usage: npm run import:calls --workspace=backend -- <source>",
    );
    process.exitCode = 1;
    return;
  }
  const filePath = path.join(SAMPLES_DIR, SAMPLE_FILES[source]);
  const buffer = readFileSync(filePath);
  const result = await importCallsFile(source, buffer, { fileName: path.basename(filePath), fileSizeBytes: buffer.length, uploadedByUserId: null });
  logger.info(result, `${result.importCode}: complete`);
}

// `file://${process.argv[1]}` string concatenation never matches on Windows: import.meta.url
// uses forward slashes with a file:/// prefix, while process.argv[1] is the raw backslash path -
// confirmed directly by printing both sides, and it silently made main() never run at all rather
// than erroring. pathToFileURL normalizes both sides correctly on every platform.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main()
    .catch((err) => {
      logger.critical({ err }, "importCalls failed");
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
