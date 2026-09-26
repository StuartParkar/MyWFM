import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export type ImportStatus =
  | "STAGED"
  | "VALIDATING"
  | "NORMALIZING"
  | "DUPLICATE_CHECK"
  | "DATA_QUALITY"
  | "MERGING"
  | "COMPLETED"
  | "FAILED";

export interface CreateImportRunInput {
  sourceSystem: string;
  sourceType: string;
  fileName: string;
  fileSizeBytes?: number;
  fileHash?: string;
  uploadedByUserId: string | null;
  mappingVersion?: string;
}

export async function createImportRun(input: CreateImportRunInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("SourceSystem", sql.VarChar(50), input.sourceSystem)
    .input("SourceType", sql.VarChar(50), input.sourceType)
    .input("FileName", sql.NVarChar(260), input.fileName)
    .input("FileSizeBytes", sql.BigInt, input.fileSizeBytes ?? null)
    .input("FileHash", sql.Char(64), input.fileHash ?? null)
    .input("UploadedByUserId", sql.UniqueIdentifier, input.uploadedByUserId)
    .input("MappingVersion", sql.VarChar(30), input.mappingVersion ?? null)
    .query<{ ImportRunId: number }>(`
      INSERT INTO [import].ImportRun (SourceSystem, SourceType, FileName, FileSizeBytes, FileHash, UploadedByUserId, MappingVersion, Status, StartedAt)
      OUTPUT INSERTED.ImportRunId
      VALUES (@SourceSystem, @SourceType, @FileName, @FileSizeBytes, @FileHash, @UploadedByUserId, @MappingVersion, 'STAGED', SYSUTCDATETIME())
    `);
  return result.recordset[0]!.ImportRunId;
}

export async function setImportRunStatus(importRunId: number, status: ImportStatus, errorMessage?: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("ImportRunId", sql.BigInt, importRunId)
    .input("Status", sql.VarChar(30), status)
    .input("ErrorMessage", sql.NVarChar(sql.MAX), errorMessage ?? null)
    .query(`UPDATE [import].ImportRun SET Status = @Status, ErrorMessage = @ErrorMessage WHERE ImportRunId = @ImportRunId`);
}

export interface ImportRunCounts {
  recordsReceived: number;
  recordsAccepted: number;
  recordsRejected: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsDuplicate: number;
}

export async function completeImportRun(importRunId: number, counts: ImportRunCounts, startedAt: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("ImportRunId", sql.BigInt, importRunId)
    .input("RecordsReceived", sql.Int, counts.recordsReceived)
    .input("RecordsAccepted", sql.Int, counts.recordsAccepted)
    .input("RecordsRejected", sql.Int, counts.recordsRejected)
    .input("RecordsInserted", sql.Int, counts.recordsInserted)
    .input("RecordsUpdated", sql.Int, counts.recordsUpdated)
    .input("RecordsDuplicate", sql.Int, counts.recordsDuplicate)
    .input("DurationMs", sql.Int, Date.now() - startedAt)
    .query(`
      UPDATE [import].ImportRun
      SET Status = 'COMPLETED', RecordsReceived = @RecordsReceived, RecordsAccepted = @RecordsAccepted,
          RecordsRejected = @RecordsRejected, RecordsInserted = @RecordsInserted, RecordsUpdated = @RecordsUpdated,
          RecordsDuplicate = @RecordsDuplicate, DurationMs = @DurationMs, CompletedAt = SYSUTCDATETIME()
      WHERE ImportRunId = @ImportRunId
    `);
}

export interface DataQualityIssueInput {
  importRunId: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  issueType: string;
  recordReference?: string;
  description: string;
  suggestedAction?: string;
}

export async function createDataQualityIssue(input: DataQualityIssueInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("ImportRunId", sql.BigInt, input.importRunId)
    .input("Severity", sql.VarChar(20), input.severity)
    .input("IssueType", sql.VarChar(50), input.issueType)
    .input("RecordReference", sql.NVarChar(200), input.recordReference ?? null)
    .input("Description", sql.NVarChar(500), input.description)
    .input("SuggestedAction", sql.NVarChar(500), input.suggestedAction ?? null)
    .query(`
      INSERT INTO [import].DataQualityIssue (ImportRunId, Severity, IssueType, RecordReference, Description, SuggestedAction)
      VALUES (@ImportRunId, @Severity, @IssueType, @RecordReference, @Description, @SuggestedAction)
    `);
}

export interface ImportRunListItem {
  importRunId: number;
  importCode: string;
  sourceSystem: string;
  fileName: string;
  status: ImportStatus;
  uploadedAt: string;
  recordsReceived: number | null;
  recordsAccepted: number | null;
  recordsRejected: number | null;
  durationMs: number | null;
  dataQualityIssueCount: number;
}

function toImportCode(id: number): string {
  return `IMPORT-${String(id).padStart(8, "0")}`;
}

export async function listImportRuns(page: number, pageSize: number): Promise<PaginatedResult<ImportRunListItem>> {
  const pool = await getPool();
  const offset = (page - 1) * pageSize;
  const result = await pool
    .request()
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, pageSize)
    .query<{
      ImportRunId: number;
      SourceSystem: string;
      FileName: string;
      Status: ImportStatus;
      UploadedAt: Date;
      RecordsReceived: number | null;
      RecordsAccepted: number | null;
      RecordsRejected: number | null;
      DurationMs: number | null;
      DataQualityIssueCount: number;
      TotalCount: number;
    }>(`
      SELECT
        ir.ImportRunId, ir.SourceSystem, ir.FileName, ir.Status, ir.UploadedAt,
        ir.RecordsReceived, ir.RecordsAccepted, ir.RecordsRejected, ir.DurationMs,
        (SELECT COUNT(*) FROM [import].DataQualityIssue dq WHERE dq.ImportRunId = ir.ImportRunId) AS DataQualityIssueCount,
        COUNT(*) OVER() AS TotalCount
      FROM [import].ImportRun ir
      ORDER BY ir.UploadedAt DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);

  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      importRunId: r.ImportRunId,
      importCode: toImportCode(r.ImportRunId),
      sourceSystem: r.SourceSystem,
      fileName: r.FileName,
      status: r.Status,
      uploadedAt: r.UploadedAt.toISOString(),
      recordsReceived: r.RecordsReceived,
      recordsAccepted: r.RecordsAccepted,
      recordsRejected: r.RecordsRejected,
      durationMs: r.DurationMs,
      dataQualityIssueCount: r.DataQualityIssueCount,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export interface DataQualityIssueListItem {
  id: number;
  importRunId: number;
  importCode: string;
  severity: string;
  issueType: string;
  recordReference: string | null;
  description: string;
  suggestedAction: string | null;
  status: string;
  createdAt: string;
}

export async function listDataQualityIssues(page: number, pageSize: number, status?: string): Promise<PaginatedResult<DataQualityIssueListItem>> {
  const pool = await getPool();
  const offset = (page - 1) * pageSize;
  const request = pool.request().input("Offset", sql.Int, offset).input("PageSize", sql.Int, pageSize);
  if (status) request.input("Status", sql.VarChar(20), status);

  const result = await request.query<{
    DataQualityIssueId: number;
    ImportRunId: number;
    Severity: string;
    IssueType: string;
    RecordReference: string | null;
    Description: string;
    SuggestedAction: string | null;
    Status: string;
    CreatedAt: Date;
    TotalCount: number;
  }>(`
    SELECT dq.DataQualityIssueId, dq.ImportRunId, dq.Severity, dq.IssueType, dq.RecordReference, dq.Description,
           dq.SuggestedAction, dq.Status, dq.CreatedAt, COUNT(*) OVER() AS TotalCount
    FROM [import].DataQualityIssue dq
    WHERE (@Status IS NULL OR dq.Status = @Status)
    ORDER BY
      CASE dq.Severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      dq.CreatedAt DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      id: r.DataQualityIssueId,
      importRunId: r.ImportRunId,
      importCode: toImportCode(r.ImportRunId),
      severity: r.Severity,
      issueType: r.IssueType,
      recordReference: r.RecordReference,
      description: r.Description,
      suggestedAction: r.SuggestedAction,
      status: r.Status,
      createdAt: r.CreatedAt.toISOString(),
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function setDataQualityIssueStatus(id: number, status: string): Promise<void> {
  const pool = await getPool();
  await pool.request().input("Id", sql.BigInt, id).input("Status", sql.VarChar(20), status).query(`
    UPDATE [import].DataQualityIssue SET Status = @Status WHERE DataQualityIssueId = @Id
  `);
}
