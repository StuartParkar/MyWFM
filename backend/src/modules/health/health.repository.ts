import { getPool, sql } from "../../db/pool.js";
import type { SystemHealthReport } from "./health.service.js";

export async function insertHealthSnapshot(report: SystemHealthReport): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Status", sql.VarChar(20), report.status)
    .input("DatabaseStatus", sql.VarChar(10), report.database.status)
    .input("DatabaseLatencyMs", sql.Int, report.database.status === "UP" ? report.database.latencyMs : null)
    .input("JobsQueued", sql.Int, report.backgroundJobs?.queued ?? 0)
    .input("JobsRunning", sql.Int, report.backgroundJobs?.running ?? 0)
    .input("JobsFailedLast24h", sql.Int, report.backgroundJobs?.failedLast24h ?? 0)
    .query(`
      INSERT INTO [system].HealthSnapshot (Status, DatabaseStatus, DatabaseLatencyMs, JobsQueued, JobsRunning, JobsFailedLast24h)
      VALUES (@Status, @DatabaseStatus, @DatabaseLatencyMs, @JobsQueued, @JobsRunning, @JobsFailedLast24h)
    `);
}

export interface HealthSnapshotRow {
  snapshotId: number;
  capturedAt: string;
  status: string;
  databaseStatus: string;
  databaseLatencyMs: number | null;
  jobsQueued: number;
  jobsRunning: number;
  jobsFailedLast24h: number;
}

export async function listHealthSnapshots(from: string, to: string): Promise<HealthSnapshotRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.DateTime2, from)
    .input("To", sql.DateTime2, to)
    .query<{
      SnapshotId: number;
      CapturedAt: Date;
      Status: string;
      DatabaseStatus: string;
      DatabaseLatencyMs: number | null;
      JobsQueued: number;
      JobsRunning: number;
      JobsFailedLast24h: number;
    }>(`
      SELECT SnapshotId, CapturedAt, Status, DatabaseStatus, DatabaseLatencyMs, JobsQueued, JobsRunning, JobsFailedLast24h
      FROM [system].HealthSnapshot
      WHERE CapturedAt >= @From AND CapturedAt <= @To
      ORDER BY CapturedAt DESC
    `);
  return result.recordset.map((r) => ({
    snapshotId: r.SnapshotId,
    capturedAt: r.CapturedAt.toISOString(),
    status: r.Status,
    databaseStatus: r.DatabaseStatus,
    databaseLatencyMs: r.DatabaseLatencyMs,
    jobsQueued: r.JobsQueued,
    jobsRunning: r.JobsRunning,
    jobsFailedLast24h: r.JobsFailedLast24h,
  }));
}
