import { getPool, sql } from "../../db/pool.js";

export interface DailyCallVolumeRow {
  businessDate: string;
  queueId: number;
  queueName: string | null;
  offeredCalls: number;
}

/** Real, historical Offered Calls per (BusinessDate, Queue) - the Forecast Engine's only input
 * (build spec section 21). No aggregate beyond a plain count is needed here. */
export async function listDailyCallVolume(params: { from: string; to: string; queueId?: number }): Promise<DailyCallVolumeRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from)
    .input("To", sql.Date, params.to)
    .input("QueueId", sql.Int, params.queueId ?? null)
    .query<{ BusinessDate: string; QueueId: number; QueueName: string | null; OfferedCalls: number }>(`
      SELECT CONVERT(VARCHAR(10), q.BusinessDate, 23) AS BusinessDate, q.QueueId, mq.QueueName, COUNT(*) AS OfferedCalls
      FROM [calls].QueueIntervalCall q
      LEFT JOIN [master].Queue mq ON mq.QueueId = q.QueueId
      WHERE q.BusinessDate BETWEEN @From AND @To
        AND (@QueueId IS NULL OR q.QueueId = @QueueId)
      GROUP BY q.BusinessDate, q.QueueId, mq.QueueName
      ORDER BY q.BusinessDate
    `);
  return result.recordset.map((r) => ({ businessDate: r.BusinessDate, queueId: r.QueueId, queueName: r.QueueName, offeredCalls: r.OfferedCalls }));
}
