import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export interface InsertReprocessingRequestInput {
  calculationType: string;
  from: string;
  to: string;
  scopeJson: string;
  reason: string;
  requestedByUserId: string;
  status: "COMPLETED" | "FAILED";
  resultSummary: unknown;
  errorMessage: string | null;
}

export interface ReprocessingRequestRow {
  requestId: number;
  calculationType: string;
  fromDate: string;
  toDate: string;
  scope: unknown;
  reason: string;
  requestedByUserId: string;
  requestedByName: string | null;
  requestedAt: string;
  status: string;
  resultSummary: unknown;
  errorMessage: string | null;
}

export async function insertReprocessingRequest(input: InsertReprocessingRequestInput): Promise<ReprocessingRequestRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("CalculationType", sql.VarChar(50), input.calculationType)
    .input("FromDate", sql.Date, input.from)
    .input("ToDate", sql.Date, input.to)
    .input("ScopeJson", sql.NVarChar(500), input.scopeJson)
    .input("Reason", sql.NVarChar(500), input.reason)
    .input("RequestedByUserId", sql.UniqueIdentifier, input.requestedByUserId)
    .input("Status", sql.VarChar(20), input.status)
    .input("ResultSummary", sql.NVarChar(sql.MAX), input.resultSummary !== null ? JSON.stringify(input.resultSummary) : null)
    .input("ErrorMessage", sql.NVarChar(sql.MAX), input.errorMessage)
    .query<{ RequestId: number; RequestedAt: Date }>(`
      INSERT INTO [system].ReprocessingRequest (CalculationType, FromDate, ToDate, ScopeJson, Reason, RequestedByUserId, Status, ResultSummary, ErrorMessage)
      OUTPUT INSERTED.RequestId, INSERTED.RequestedAt
      VALUES (@CalculationType, @FromDate, @ToDate, @ScopeJson, @Reason, @RequestedByUserId, @Status, @ResultSummary, @ErrorMessage)
    `);
  const inserted = result.recordset[0]!;
  return {
    requestId: inserted.RequestId,
    calculationType: input.calculationType,
    fromDate: input.from,
    toDate: input.to,
    scope: JSON.parse(input.scopeJson),
    reason: input.reason,
    requestedByUserId: input.requestedByUserId,
    requestedByName: null,
    requestedAt: inserted.RequestedAt.toISOString(),
    status: input.status,
    resultSummary: input.resultSummary,
    errorMessage: input.errorMessage,
  };
}

export async function listReprocessingRequests(page: number, pageSize: number): Promise<PaginatedResult<ReprocessingRequestRow>> {
  const pool = await getPool();
  const offset = (page - 1) * pageSize;
  const result = await pool
    .request()
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, pageSize)
    .query<{
      RequestId: number;
      CalculationType: string;
      FromDate: string;
      ToDate: string;
      ScopeJson: string | null;
      Reason: string;
      RequestedByUserId: string;
      RequestedByName: string | null;
      RequestedAt: Date;
      Status: string;
      ResultSummary: string | null;
      ErrorMessage: string | null;
      TotalCount: number;
    }>(`
      SELECT rr.RequestId, rr.CalculationType, CONVERT(VARCHAR(10), rr.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), rr.ToDate, 23) AS ToDate,
             rr.ScopeJson, rr.Reason, rr.RequestedByUserId, u.DisplayName AS RequestedByName, rr.RequestedAt, rr.Status, rr.ResultSummary, rr.ErrorMessage,
             COUNT(*) OVER() AS TotalCount
      FROM [system].ReprocessingRequest rr
      LEFT JOIN security.[User] u ON u.UserId = rr.RequestedByUserId
      ORDER BY rr.RequestedAt DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      requestId: r.RequestId,
      calculationType: r.CalculationType,
      fromDate: r.FromDate,
      toDate: r.ToDate,
      scope: r.ScopeJson ? JSON.parse(r.ScopeJson) : null,
      reason: r.Reason,
      requestedByUserId: r.RequestedByUserId,
      requestedByName: r.RequestedByName,
      requestedAt: r.RequestedAt.toISOString(),
      status: r.Status,
      resultSummary: r.ResultSummary ? JSON.parse(r.ResultSummary) : null,
      errorMessage: r.ErrorMessage,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}
