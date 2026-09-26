import ExcelJS from "exceljs";
import { getPool, sql } from "../../db/pool.js";
import { logger } from "../../logger/logger.js";
import * as importRepo from "../imports/import.repository.js";
import { recordAudit } from "../audit/audit.service.js";
import * as callsRepo from "./calls.repository.js";
import { buildAliasIndex } from "./parsers/agentAliasResolver.js";
import { parseElevate } from "./parsers/elevateParser.js";
import { parseRingCentralCalls } from "./parsers/ringCentralCallsParser.js";
import { parseVonageCompanySummary } from "./parsers/vonageCompanySummaryParser.js";
import { parseVonageQueueWise } from "./parsers/vonageQueueWiseParser.js";
import type { ParseResult, RawRow } from "./parsers/types.js";

export type CallsSource = "vonage-queuewise" | "vonage-company-summary" | "elevate" | "ringcentral-calls";

interface SourceConfig {
  sheetName: string;
  sourceSystem: string;
  timezone: string;
  parse: (rows: RawRow[], aliasIndex: Awaited<ReturnType<typeof buildAliasIndex>>, timezone: string) => ParseResult;
}

/**
 * One phone system's timestamps are naive (no timezone recorded, per build spec section 76's
 * inspection) - the account's own configured timezone, confirmed directly rather than
 * assumed: Elevate is Pacific, the other two systems are Eastern.
 */
const SOURCES: Record<CallsSource, SourceConfig> = {
  "vonage-queuewise": { sheetName: "Vonage QueueWise", sourceSystem: "VONAGE", timezone: "America/New_York", parse: parseVonageQueueWise },
  "vonage-company-summary": { sheetName: "Vonage - Company Summary", sourceSystem: "VONAGE", timezone: "America/New_York", parse: parseVonageCompanySummary },
  elevate: { sheetName: "Elevate", sourceSystem: "ELEVATE", timezone: "America/Los_Angeles", parse: parseElevate },
  "ringcentral-calls": { sheetName: "Calls", sourceSystem: "RINGCENTRAL", timezone: "America/New_York", parse: parseRingCentralCalls },
};

export function isCallsSource(value: string): value is CallsSource {
  return value in SOURCES;
}

export function worksheetToObjects(ws: ExcelJS.Worksheet): RawRow[] {
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rows: RawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.cellCount === 0) continue;
    const obj: RawRow = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (!header) return;
      obj[header] = cell.value;
      if (cell.value != null) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

async function upsertQueue(name: string): Promise<number> {
  const code = name.length > 50 ? name.slice(0, 50) : name;
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Code", sql.VarChar(50), code)
    .input("Name", sql.NVarChar(150), name)
    .query<{ id: number }>(`
      MERGE [master].Queue AS target
      USING (SELECT @Code AS Code) AS source
      ON target.QueueCode = source.Code
      WHEN NOT MATCHED THEN INSERT (QueueCode, QueueName) VALUES (@Code, @Name)
      OUTPUT INSERTED.QueueId AS id;
    `);
  if (result.recordset[0]) return result.recordset[0].id;
  const existing = await pool.request().input("Code", sql.VarChar(50), code).query<{ id: number }>(
    `SELECT QueueId AS id FROM [master].Queue WHERE QueueCode = @Code`,
  );
  return existing.recordset[0]!.id;
}

export interface CallsImportResult {
  importRunId: number;
  importCode: string;
  recordsReceived: number;
  recordsAccepted: number;
  recordsRejected: number;
  queueRowsInserted: number;
  agentRowsInserted: number;
  dataQualityIssueCount: number;
}

export async function importCallsFile(
  source: CallsSource,
  buffer: Buffer,
  opts: { fileName: string; fileSizeBytes: number; uploadedByUserId: string | null },
): Promise<CallsImportResult> {
  const config = SOURCES[source];
  const startedAt = Date.now();
  const importRunId = await importRepo.createImportRun({
    sourceSystem: config.sourceSystem,
    sourceType: "XLSX",
    fileName: opts.fileName,
    fileSizeBytes: opts.fileSizeBytes,
    uploadedByUserId: opts.uploadedByUserId,
    mappingVersion: `${config.sourceSystem}-V1`,
  });

  let dataQualityIssueCount = 0;
  const issue = async (input: Omit<Parameters<typeof importRepo.createDataQualityIssue>[0], "importRunId">) => {
    dataQualityIssueCount += 1;
    await importRepo.createDataQualityIssue({ ...input, importRunId });
  };

  try {
    await importRepo.setImportRunStatus(importRunId, "VALIDATING");
    const workbook = new ExcelJS.Workbook();
    // exceljs's own index.d.ts (line 1) declares a local, module-scoped
    // `declare interface Buffer extends ArrayBuffer {}` so it doesn't hard-depend on
    // @types/node - every `Buffer` reference inside exceljs's own types (including
    // `load()`'s parameter) resolves to that empty stub, not Node's real Buffer class, and
    // Node's real Buffer (extends Uint8Array, not ArrayBuffer) is structurally incompatible
    // with it. No cast to the real Buffer type can satisfy this; `any` is the standard
    // workaround for this known exceljs typing gap. Real Buffer in, real Buffer at runtime.
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(config.sheetName);
    if (!worksheet) {
      throw new Error(`Expected a sheet named "${config.sheetName}" in the uploaded workbook.`);
    }
    const rawRows = worksheetToObjects(worksheet);

    await importRepo.setImportRunStatus(importRunId, "NORMALIZING");
    const aliasIndex = await buildAliasIndex();
    const parsed = config.parse(rawRows, aliasIndex, config.timezone);

    for (const p of parsed.issues) {
      await issue({
        severity: p.severity,
        issueType: p.issueType,
        recordReference: p.rowReference,
        description: p.description,
        suggestedAction: p.suggestedAction,
      });
    }

    await importRepo.setImportRunStatus(importRunId, "MERGING");
    const queueIdByName = new Map<string, number>();
    for (const row of parsed.queueRows) {
      if (!queueIdByName.has(row.queueName)) queueIdByName.set(row.queueName, await upsertQueue(row.queueName));
    }
    for (const row of parsed.agentRows) {
      if (row.queueName && !queueIdByName.has(row.queueName)) queueIdByName.set(row.queueName, await upsertQueue(row.queueName));
    }

    for (const row of parsed.queueRows) {
      await callsRepo.createQueueIntervalCall({ ...row, importRunId, queueId: queueIdByName.get(row.queueName) ?? null });
    }
    for (const row of parsed.agentRows) {
      await callsRepo.createAgentIntervalCall({
        ...row,
        importRunId,
        queueId: row.queueName ? (queueIdByName.get(row.queueName) ?? null) : null,
      });
    }

    const counts: importRepo.ImportRunCounts = {
      recordsReceived: parsed.recordsReceived,
      recordsAccepted: parsed.recordsReceived - parsed.recordsRejected,
      recordsRejected: parsed.recordsRejected,
      recordsInserted: parsed.queueRows.length + parsed.agentRows.length,
      recordsUpdated: 0,
      recordsDuplicate: 0,
    };
    await importRepo.completeImportRun(importRunId, counts, startedAt);

    await recordAudit({
      entityType: "CallsImport",
      action: "IMPORT",
      referenceId: `IMPORT-${String(importRunId).padStart(8, "0")}`,
      after: { source, ...counts },
      reason: `imported from ${opts.fileName}`,
    });

    logger.info({ importRunId, source, ...counts, dataQualityIssueCount }, "Calls import complete");
    return {
      importRunId,
      importCode: `IMPORT-${String(importRunId).padStart(8, "0")}`,
      recordsReceived: counts.recordsReceived,
      recordsAccepted: counts.recordsAccepted,
      recordsRejected: counts.recordsRejected,
      queueRowsInserted: parsed.queueRows.length,
      agentRowsInserted: parsed.agentRows.length,
      dataQualityIssueCount,
    };
  } catch (err) {
    await importRepo.setImportRunStatus(importRunId, "FAILED", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
