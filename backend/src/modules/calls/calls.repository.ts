import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

/**
 * The universal call structure (build spec section 16), split into two separate fact tables
 * because queue-level and agent-level records have different grains and must never be summed
 * as if they were one thing. Every row is one real call (all three real phone-system exports
 * are call-detail, never pre-aggregated intervals - see documentation/phone-system-mapping.md)
 * - Offered/Answered/Abandoned/AHTSeconds are aggregate-only concepts that don't mean anything
 * on a single call, so they are computed at report time, never stored here.
 */
export interface CallIntervalRow {
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  timezone: string;
  sourceCallId: string | null;
  direction: string | null;
  waitSeconds: number | null;
  talkSeconds: number | null;
  holdSeconds: number | null;
  acwSeconds: number | null;
  handleSeconds: number | null;
  disposition: string | null;
}

export interface QueueIntervalCallRow extends CallIntervalRow {
  queueIntervalCallId: number;
  queueId: number | null;
  queueName: string | null;
  sourceQueueId: string;
  agentId: string | null;
  agentName: string | null;
  sourceAgentId: string | null;
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
  CONVERT(VARCHAR(10), BusinessDate, 23) AS BusinessDate, IntervalStart, IntervalEnd, Timezone, SourceCallId, Direction,
  WaitSeconds, TalkSeconds, HoldSeconds, ACWSeconds, HandleSeconds, Disposition
`;

function mapIntervalRow(row: {
  BusinessDate: string;
  IntervalStart: Date;
  IntervalEnd: Date;
  Timezone: string;
  SourceCallId: string | null;
  Direction: string | null;
  WaitSeconds: number | null;
  TalkSeconds: number | null;
  HoldSeconds: number | null;
  ACWSeconds: number | null;
  HandleSeconds: number | null;
  Disposition: string | null;
}): CallIntervalRow {
  return {
    businessDate: row.BusinessDate,
    intervalStart: row.IntervalStart.toISOString(),
    intervalEnd: row.IntervalEnd.toISOString(),
    timezone: row.Timezone,
    sourceCallId: row.SourceCallId,
    direction: row.Direction,
    waitSeconds: row.WaitSeconds,
    talkSeconds: row.TalkSeconds,
    holdSeconds: row.HoldSeconds,
    acwSeconds: row.ACWSeconds,
    handleSeconds: row.HandleSeconds,
    disposition: row.Disposition,
  };
}

export interface CreateQueueIntervalCallInput {
  importRunId: number;
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  timezone: string;
  sourceCallId?: string | null;
  sourceQueueId: string;
  queueId?: number | null;
  queueName?: string | null;
  sourceAgentId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  direction?: string | null;
  waitSeconds?: number | null;
  talkSeconds?: number | null;
  holdSeconds?: number | null;
  acwSeconds?: number | null;
  handleSeconds?: number | null;
  disposition?: string | null;
}

export async function createQueueIntervalCall(input: CreateQueueIntervalCallInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("ImportRunId", sql.BigInt, input.importRunId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("IntervalStart", sql.DateTime2, new Date(input.intervalStart))
    .input("IntervalEnd", sql.DateTime2, new Date(input.intervalEnd))
    .input("Timezone", sql.VarChar(50), input.timezone)
    .input("SourceCallId", sql.NVarChar(100), input.sourceCallId ?? null)
    .input("SourceQueueId", sql.NVarChar(100), input.sourceQueueId)
    .input("QueueId", sql.Int, input.queueId ?? null)
    .input("QueueName", sql.NVarChar(150), input.queueName ?? null)
    .input("SourceAgentId", sql.NVarChar(100), input.sourceAgentId ?? null)
    .input("AgentId", sql.UniqueIdentifier, input.agentId ?? null)
    .input("AgentName", sql.NVarChar(200), input.agentName ?? null)
    .input("Direction", sql.VarChar(20), input.direction ?? null)
    .input("WaitSeconds", sql.Int, input.waitSeconds ?? null)
    .input("TalkSeconds", sql.Int, input.talkSeconds ?? null)
    .input("HoldSeconds", sql.Int, input.holdSeconds ?? null)
    .input("ACWSeconds", sql.Int, input.acwSeconds ?? null)
    .input("HandleSeconds", sql.Int, input.handleSeconds ?? null)
    .input("Disposition", sql.NVarChar(100), input.disposition ?? null)
    .query<{ QueueIntervalCallId: number }>(`
      INSERT INTO [calls].QueueIntervalCall
        (ImportRunId, BusinessDate, IntervalStart, IntervalEnd, Timezone, SourceCallId, SourceQueueId, QueueId, QueueName,
         SourceAgentId, AgentId, AgentName, Direction, WaitSeconds, TalkSeconds, HoldSeconds, ACWSeconds, HandleSeconds, Disposition)
      OUTPUT INSERTED.QueueIntervalCallId
      VALUES
        (@ImportRunId, @BusinessDate, @IntervalStart, @IntervalEnd, @Timezone, @SourceCallId, @SourceQueueId, @QueueId, @QueueName,
         @SourceAgentId, @AgentId, @AgentName, @Direction, @WaitSeconds, @TalkSeconds, @HoldSeconds, @ACWSeconds, @HandleSeconds, @Disposition)
    `);
  return result.recordset[0]!.QueueIntervalCallId;
}

export interface CreateAgentIntervalCallInput {
  importRunId: number;
  businessDate: string;
  intervalStart: string;
  intervalEnd: string;
  timezone: string;
  sourceCallId?: string | null;
  sourceAgentId: string;
  agentId?: string | null;
  agentName?: string | null;
  sourceQueueId?: string | null;
  queueId?: number | null;
  queueName?: string | null;
  direction?: string | null;
  waitSeconds?: number | null;
  talkSeconds?: number | null;
  holdSeconds?: number | null;
  acwSeconds?: number | null;
  handleSeconds?: number | null;
  disposition?: string | null;
}

export async function createAgentIntervalCall(input: CreateAgentIntervalCallInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("ImportRunId", sql.BigInt, input.importRunId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("IntervalStart", sql.DateTime2, new Date(input.intervalStart))
    .input("IntervalEnd", sql.DateTime2, new Date(input.intervalEnd))
    .input("Timezone", sql.VarChar(50), input.timezone)
    .input("SourceCallId", sql.NVarChar(100), input.sourceCallId ?? null)
    .input("SourceAgentId", sql.NVarChar(100), input.sourceAgentId)
    .input("AgentId", sql.UniqueIdentifier, input.agentId ?? null)
    .input("AgentName", sql.NVarChar(200), input.agentName ?? null)
    .input("SourceQueueId", sql.NVarChar(100), input.sourceQueueId ?? null)
    .input("QueueId", sql.Int, input.queueId ?? null)
    .input("QueueName", sql.NVarChar(150), input.queueName ?? null)
    .input("Direction", sql.VarChar(20), input.direction ?? null)
    .input("WaitSeconds", sql.Int, input.waitSeconds ?? null)
    .input("TalkSeconds", sql.Int, input.talkSeconds ?? null)
    .input("HoldSeconds", sql.Int, input.holdSeconds ?? null)
    .input("ACWSeconds", sql.Int, input.acwSeconds ?? null)
    .input("HandleSeconds", sql.Int, input.handleSeconds ?? null)
    .input("Disposition", sql.NVarChar(100), input.disposition ?? null)
    .query<{ AgentIntervalCallId: number }>(`
      INSERT INTO [calls].AgentIntervalCall
        (ImportRunId, BusinessDate, IntervalStart, IntervalEnd, Timezone, SourceCallId, SourceAgentId, AgentId, AgentName,
         SourceQueueId, QueueId, QueueName, Direction, WaitSeconds, TalkSeconds, HoldSeconds, ACWSeconds, HandleSeconds, Disposition)
      OUTPUT INSERTED.AgentIntervalCallId
      VALUES
        (@ImportRunId, @BusinessDate, @IntervalStart, @IntervalEnd, @Timezone, @SourceCallId, @SourceAgentId, @AgentId, @AgentName,
         @SourceQueueId, @QueueId, @QueueName, @Direction, @WaitSeconds, @TalkSeconds, @HoldSeconds, @ACWSeconds, @HandleSeconds, @Disposition)
    `);
  return result.recordset[0]!.AgentIntervalCallId;
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
      AgentId: string | null;
      AgentName: string | null;
      SourceAgentId: string | null;
      BusinessDate: string;
      IntervalStart: Date;
      IntervalEnd: Date;
      Timezone: string;
      SourceCallId: string | null;
      Direction: string | null;
      WaitSeconds: number | null;
      TalkSeconds: number | null;
      HoldSeconds: number | null;
      ACWSeconds: number | null;
      HandleSeconds: number | null;
      Disposition: string | null;
      TotalCount: number;
    }>(`
      SELECT QueueIntervalCallId, QueueId, QueueName, SourceQueueId, AgentId, AgentName, SourceAgentId, ${INTERVAL_COLUMNS}, COUNT(*) OVER() AS TotalCount
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
      agentId: r.AgentId,
      agentName: r.AgentName,
      sourceAgentId: r.SourceAgentId,
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
      SourceCallId: string | null;
      Direction: string | null;
      WaitSeconds: number | null;
      TalkSeconds: number | null;
      HoldSeconds: number | null;
      ACWSeconds: number | null;
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
