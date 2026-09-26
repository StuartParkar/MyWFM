import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

/**
 * The universal call structure (build spec section 16), split into two separate fact tables
 * because queue-level and agent-level records have different grains and must never be summed
 * as if they were one thing. Both share the same field vocabulary below on purpose - there is
 * no importer yet to populate either (see documentation/phone-system-mapping.md), so these
 * queries only ever prove the read path works, not that any data exists.
 */
export interface CallIntervalRow {
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  timezone: string;
  direction: string | null;
  offered: number | null;
  answered: number | null;
  abandoned: number | null;
  talkSeconds: number | null;
  holdSeconds: number | null;
  acwSeconds: number | null;
  ahtSeconds: number | null;
  handleSeconds: number | null;
  disposition: string | null;
}

export interface QueueIntervalCallRow extends CallIntervalRow {
  queueIntervalCallId: number;
  queueId: number | null;
  queueName: string | null;
  sourceQueueId: string;
}

export interface AgentIntervalCallRow extends CallIntervalRow {
  agentIntervalCallId: number;
  agentId: string | null;
  agentName: string | null;
  sourceAgentId: string;
  queueId: number | null;
  queueName: string | null;
}

const INTERVAL_COLUMNS = `
  CONVERT(VARCHAR(10), BusinessDate, 23) AS BusinessDate, IntervalStart, IntervalEnd, Timezone, Direction,
  Offered, Answered, Abandoned, TalkSeconds, HoldSeconds, ACWSeconds, AHTSeconds, HandleSeconds, Disposition
`;

function mapIntervalRow(row: {
  BusinessDate: string;
  IntervalStart: Date;
  IntervalEnd: Date;
  Timezone: string;
  Direction: string | null;
  Offered: number | null;
  Answered: number | null;
  Abandoned: number | null;
  TalkSeconds: number | null;
  HoldSeconds: number | null;
  ACWSeconds: number | null;
  AHTSeconds: number | null;
  HandleSeconds: number | null;
  Disposition: string | null;
}): CallIntervalRow {
  return {
    businessDate: row.BusinessDate,
    intervalStart: row.IntervalStart.toISOString(),
    intervalEnd: row.IntervalEnd.toISOString(),
    timezone: row.Timezone,
    direction: row.Direction,
    offered: row.Offered,
    answered: row.Answered,
    abandoned: row.Abandoned,
    talkSeconds: row.TalkSeconds,
    holdSeconds: row.HoldSeconds,
    acwSeconds: row.ACWSeconds,
    ahtSeconds: row.AHTSeconds,
    handleSeconds: row.HandleSeconds,
    disposition: row.Disposition,
  };
}

export async function listQueueIntervals(params: {
  from: string;
  to: string;
  queueId?: number;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<QueueIntervalCallRow>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("QueueId", sql.Int, params.queueId ?? null)
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize)
    .query<{
      QueueIntervalCallId: number;
      QueueId: number | null;
      QueueName: string | null;
      SourceQueueId: string;
      BusinessDate: string;
      IntervalStart: Date;
      IntervalEnd: Date;
      Timezone: string;
      Direction: string | null;
      Offered: number | null;
      Answered: number | null;
      Abandoned: number | null;
      TalkSeconds: number | null;
      HoldSeconds: number | null;
      ACWSeconds: number | null;
      AHTSeconds: number | null;
      HandleSeconds: number | null;
      Disposition: string | null;
      TotalCount: number;
    }>(`
      SELECT QueueIntervalCallId, QueueId, QueueName, SourceQueueId, ${INTERVAL_COLUMNS}, COUNT(*) OVER() AS TotalCount
      FROM [calls].QueueIntervalCall
      WHERE BusinessDate BETWEEN @From AND @To
        AND (@QueueId IS NULL OR QueueId = @QueueId)
      ORDER BY BusinessDate DESC, IntervalStart DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      queueIntervalCallId: r.QueueIntervalCallId,
      queueId: r.QueueId,
      queueName: r.QueueName,
      sourceQueueId: r.SourceQueueId,
      ...mapIntervalRow(r),
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}

export async function listAgentIntervals(params: {
  from: string;
  to: string;
  agentId?: string;
  queueId?: number;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<AgentIntervalCallRow>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("AgentId", sql.UniqueIdentifier, params.agentId ?? null)
    .input("QueueId", sql.Int, params.queueId ?? null)
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize)
    .query<{
      AgentIntervalCallId: number;
      AgentId: string | null;
      AgentName: string | null;
      SourceAgentId: string;
      QueueId: number | null;
      QueueName: string | null;
      BusinessDate: string;
      IntervalStart: Date;
      IntervalEnd: Date;
      Timezone: string;
      Direction: string | null;
      Offered: number | null;
      Answered: number | null;
      Abandoned: number | null;
      TalkSeconds: number | null;
      HoldSeconds: number | null;
      ACWSeconds: number | null;
      AHTSeconds: number | null;
      HandleSeconds: number | null;
      Disposition: string | null;
      TotalCount: number;
    }>(`
      SELECT AgentIntervalCallId, AgentId, AgentName, SourceAgentId, QueueId, QueueName, ${INTERVAL_COLUMNS}, COUNT(*) OVER() AS TotalCount
      FROM [calls].AgentIntervalCall
      WHERE BusinessDate BETWEEN @From AND @To
        AND (@AgentId IS NULL OR AgentId = @AgentId)
        AND (@QueueId IS NULL OR QueueId = @QueueId)
      ORDER BY BusinessDate DESC, IntervalStart DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      agentIntervalCallId: r.AgentIntervalCallId,
      agentId: r.AgentId,
      agentName: r.AgentName,
      sourceAgentId: r.SourceAgentId,
      queueId: r.QueueId,
      queueName: r.QueueName,
      ...mapIntervalRow(r),
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}
