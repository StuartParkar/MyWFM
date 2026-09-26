import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { checkDbHealth, getPool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";

export const healthRouter = Router();

interface SystemHealthReport {
  status: "UP" | "DEGRADED" | "DOWN";
  uptimeSeconds: number;
  database: Awaited<ReturnType<typeof checkDbHealth>>;
  backgroundJobs: { queued: number; running: number; failedLast24h: number } | null;
}

/**
 * Unauthenticated liveness probe (container orchestration, load balancers).
 * Deliberately returns only "is the process alive", not database detail -
 * that requires system.health.view and lives at GET /api/system-health/detail.
 */
healthRouter.get("/", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "UP" } } satisfies ApiSuccess<{ status: "UP" }>);
});

healthRouter.get("/detail", requireAuth, requirePermission("system.health.view"), async (_req, res) => {
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

  const report: SystemHealthReport = {
    status: database.status === "UP" ? "UP" : "DEGRADED",
    uptimeSeconds: Math.round(process.uptime()),
    database,
    backgroundJobs,
  };

  const body: ApiSuccess<SystemHealthReport> = { success: true, data: report };
  res.status(200).json(body);
});
