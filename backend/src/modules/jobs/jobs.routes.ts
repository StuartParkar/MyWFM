import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";

export const jobsRouter = Router();

interface JobListItem {
  JobId: number;
  JobType: string;
  Status: string;
  Attempts: number;
  MaxAttempts: number;
  ErrorMessage: string | null;
  CreatedAt: Date;
  StartedAt: Date | null;
  CompletedAt: Date | null;
}

jobsRouter.get("/", requireAuth, requirePermission("job.view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const pool = await getPool();
  const result = await pool.request().input("Limit", sql.Int, limit).query<JobListItem>(`
    SELECT TOP (@Limit) JobId, JobType, Status, Attempts, MaxAttempts, ErrorMessage, CreatedAt, StartedAt, CompletedAt
    FROM [system].BackgroundJob
    ORDER BY CreatedAt DESC
  `);
  const body: ApiSuccess<JobListItem[]> = { success: true, data: result.recordset };
  res.status(200).json(body);
});

jobsRouter.post("/:id/cancel", requireAuth, requirePermission("job.manage"), async (req, res) => {
  const jobId = Number(req.params.id);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("JobId", sql.BigInt, jobId)
    .query<{ Status: string }>(`SELECT Status FROM [system].BackgroundJob WHERE JobId = @JobId`);

  const job = result.recordset[0];
  if (!job) throw new NotFoundError("Job not found.");
  if (job.Status !== "QUEUED") {
    throw new ConflictError(`Only a QUEUED job can be cancelled (current status: ${job.Status}).`);
  }

  await pool
    .request()
    .input("JobId", sql.BigInt, jobId)
    .query(`UPDATE [system].BackgroundJob SET Status = 'CANCELLED', CompletedAt = SYSUTCDATETIME() WHERE JobId = @JobId`);

  res.status(204).send();
});
