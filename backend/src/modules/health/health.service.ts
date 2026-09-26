import { checkDbHealth, getPool } from "../../db/pool.js";

export interface SystemHealthReport {
  status: "UP" | "DEGRADED" | "DOWN";
  uptimeSeconds: number;
  database: Awaited<ReturnType<typeof checkDbHealth>>;
  backgroundJobs: { queued: number; running: number; failedLast24h: number } | null;
}

/**
 * Shared by the live GET /detail route and healthSnapshotSampler.ts, so the
 * periodic history it persists is built from exactly the same real check as
 * what an operator sees on demand - never a second, quietly-diverging version.
 */
export async function getHealthReport(): Promise<SystemHealthReport> {
  const database = await checkDbHealth();
  let backgroundJobs: SystemHealthReport["backgroundJobs"] = null;

  if (database.status === "UP") {
    const pool = await getPool();
    const result = await pool.request().query<{ Status: string; Cnt: number }>(`
      SELECT Status, COUNT(*) AS Cnt
      FROM [system].BackgroundJob
      WHERE Status IN ('QUEUED', 'RUNNING') OR (Status = 'FAILED' AND CompletedAt > DATEADD(HOUR, -24, SYSUTCDATETIME()))
      GROUP BY Status
    `);
    const byStatus = Object.fromEntries(result.recordset.map((r) => [r.Status, r.Cnt]));
    backgroundJobs = {
      queued: byStatus.QUEUED ?? 0,
      running: byStatus.RUNNING ?? 0,
      failedLast24h: byStatus.FAILED ?? 0,
    };
  }

  return {
    status: database.status === "UP" ? "UP" : "DEGRADED",
    uptimeSeconds: Math.round(process.uptime()),
    database,
    backgroundJobs,
  };
}
