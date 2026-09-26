import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { getPool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { recordAudit } from "../audit/audit.service.js";
import { enqueueJob } from "../jobs/jobQueue.js";

export const backupRouter = Router();

backupRouter.use(requireAuth);

/**
 * Enqueues a real scripts/backup-mywfm.sh run (backup.jobHandler.ts) - status
 * and the eventual manifest are polled via GET /runs below, the same
 * durable-background-job pattern the rest of the system already uses for
 * anything longer than a request/response cycle.
 */
backupRouter.post("/run", requirePermission("backup.execute"), async (req, res) => {
  const jobId = await enqueueJob("RUN_BACKUP", null, { createdBy: req.user!.userId, maxAttempts: 1 });
  await recordAudit({
    entityType: "BackupRun",
    entityId: String(jobId),
    action: "TRIGGERED",
    performedByUserId: req.user!.userId,
    reason: "Manual backup triggered from Admin > System > Backup / Restore.",
  });
  res.status(202).json({ success: true, data: { jobId } } satisfies ApiSuccess<{ jobId: number }>);
});

interface BackupRunListItem {
  jobId: number;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  result: unknown;
}

/** Real BackgroundJob rows for JobType = 'RUN_BACKUP' - also what the guided Restore runbook picks a backup from. */
backupRouter.get("/runs", requirePermission("backup.view"), async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query<{
    JobId: number;
    Status: string;
    CreatedAt: Date;
    StartedAt: Date | null;
    CompletedAt: Date | null;
    ErrorMessage: string | null;
    Result: string | null;
  }>(`
    SELECT TOP (50) JobId, Status, CreatedAt, StartedAt, CompletedAt, ErrorMessage, Result
    FROM [system].BackgroundJob
    WHERE JobType = 'RUN_BACKUP'
    ORDER BY CreatedAt DESC
  `);
  const items: BackupRunListItem[] = result.recordset.map((r) => ({
    jobId: r.JobId,
    status: r.Status,
    createdAt: r.CreatedAt.toISOString(),
    startedAt: r.StartedAt?.toISOString() ?? null,
    completedAt: r.CompletedAt?.toISOString() ?? null,
    errorMessage: r.ErrorMessage,
    result: r.Result ? JSON.parse(r.Result) : null,
  }));
  res.json({ success: true, data: items } satisfies ApiSuccess<BackupRunListItem[]>);
});
