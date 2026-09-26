import { getPool, sql } from "../../db/pool.js";

/**
 * Raw per-(BusinessDate, Queue) counts behind Answer Rate/Abandon Rate/AHT/Service
 * Level/Workload (build spec sections 17-19). Deliberately NOT pre-divided into
 * percentages here: callMetrics.service.ts re-aggregates these raw counts across
 * queues sharing a Process (for the Staffing tie-in) before computing any ratio -
 * averaging already-computed percentages across queues would be mathematically
 * wrong, summing the counts first is not.
 */
export interface CallMetricsRawRow {
  businessDate: string;
  queueId: number;
  queueName: string | null;
  processId: number | null;
  processName: string | null;
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  answeredHandleSecondsSum: number;
  answeredWithinThreshold: number;
  /** The real ImportRunId(s) behind this bucket's rows (calls.QueueIntervalCall.ImportRunId) -
   * Data Lineage's Source Reference (build spec section 23), never fabricated. */
  importRunIds: number[];
}

export async function listCallMetricsRaw(params: {
  from: string;
  to: string;
  queueId?: number;
  processId?: number;
  serviceLevelThresholdSeconds: number;
}): Promise<CallMetricsRawRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("QueueId", sql.Int, params.queueId ?? null)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .input("Threshold", sql.Int, params.serviceLevelThresholdSeconds)
    .query<{
      BusinessDate: string;
      QueueId: number;
      QueueName: string | null;
      ProcessId: number | null;
      ProcessName: string | null;
      OfferedCalls: number;
      AnsweredCalls: number;
      AbandonedCalls: number;
      AnsweredHandleSecondsSum: number | null;
      AnsweredWithinThreshold: number;
      ImportRunIds: string | null;
    }>(`
      SELECT
        CONVERT(VARCHAR(10), q.BusinessDate, 23) AS BusinessDate,
        q.QueueId, mq.QueueName, mq.ProcessId, mp.ProcessName,
        COUNT(*) AS OfferedCalls,
        SUM(CASE WHEN q.Disposition = 'ANSWERED' THEN 1 ELSE 0 END) AS AnsweredCalls,
        SUM(CASE WHEN q.Disposition = 'ABANDONED' THEN 1 ELSE 0 END) AS AbandonedCalls,
        SUM(CASE WHEN q.Disposition = 'ANSWERED'
              THEN COALESCE(q.HandleSeconds, q.TalkSeconds + ISNULL(q.HoldSeconds, 0) + ISNULL(q.ACWSeconds, 0))
              ELSE 0 END) AS AnsweredHandleSecondsSum,
        SUM(CASE WHEN q.Disposition = 'ANSWERED' AND q.WaitSeconds IS NOT NULL AND q.WaitSeconds <= @Threshold THEN 1 ELSE 0 END) AS AnsweredWithinThreshold,
        STRING_AGG(DISTINCT CAST(q.ImportRunId AS VARCHAR(20)), ',') AS ImportRunIds
      FROM [calls].QueueIntervalCall q
      LEFT JOIN [master].Queue mq ON mq.QueueId = q.QueueId
      LEFT JOIN [master].Process mp ON mp.ProcessId = mq.ProcessId
      WHERE q.BusinessDate BETWEEN @From AND @To
        AND (@QueueId IS NULL OR q.QueueId = @QueueId)
        AND (@ProcessId IS NULL OR mq.ProcessId = @ProcessId)
      GROUP BY q.BusinessDate, q.QueueId, mq.QueueName, mq.ProcessId, mp.ProcessName
      ORDER BY q.BusinessDate DESC, mq.QueueName
    `);
  return result.recordset.map((r) => ({
    businessDate: r.BusinessDate,
    queueId: r.QueueId,
    queueName: r.QueueName,
    processId: r.ProcessId,
    processName: r.ProcessName,
    offeredCalls: r.OfferedCalls,
    answeredCalls: r.AnsweredCalls,
    abandonedCalls: r.AbandonedCalls,
    answeredHandleSecondsSum: r.AnsweredHandleSecondsSum ?? 0,
    answeredWithinThreshold: r.AnsweredWithinThreshold,
    importRunIds: r.ImportRunIds ? r.ImportRunIds.split(",").map(Number) : [],
  }));
}
