import { getPool, sql } from "../../db/pool.js";
import { logger } from "../../logger/logger.js";

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type JobHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => Promise<TResult>;

const handlers = new Map<string, JobHandler>();

/** Later phases (imports, calculations, exports) register their handler here once, at module load. */
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

export interface EnqueueOptions {
  createdBy?: string;
  maxAttempts?: number;
}

export async function enqueueJob(jobType: string, payload: unknown, opts: EnqueueOptions = {}): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("JobType", sql.VarChar(100), jobType)
    .input("Payload", sql.NVarChar(sql.MAX), JSON.stringify(payload ?? null))
    .input("MaxAttempts", sql.Int, opts.maxAttempts ?? 1)
    .input("CreatedBy", sql.UniqueIdentifier, opts.createdBy ?? null)
    .query<{ JobId: number }>(`
      INSERT INTO [system].BackgroundJob (JobType, Payload, MaxAttempts, CreatedBy)
      OUTPUT INSERTED.JobId
      VALUES (@JobType, @Payload, @MaxAttempts, @CreatedBy)
    `);
  return result.recordset[0]!.JobId;
}

interface ClaimedJob {
  JobId: number;
  JobType: string;
  Payload: string | null;
  Attempts: number;
  MaxAttempts: number;
}

/**
 * Atomically claims the oldest QUEUED job using READPAST+ROWLOCK so multiple
 * worker instances can poll the same table without double-processing a row.
 */
async function claimNextJob(): Promise<ClaimedJob | null> {
  const pool = await getPool();
  const result = await pool.request().query<ClaimedJob>(`
    UPDATE [system].BackgroundJob
    SET Status = 'RUNNING', StartedAt = SYSUTCDATETIME(), Attempts = Attempts + 1
    OUTPUT INSERTED.JobId, INSERTED.JobType, INSERTED.Payload, INSERTED.Attempts, INSERTED.MaxAttempts
    WHERE JobId = (
      SELECT TOP (1) JobId
      FROM [system].BackgroundJob WITH (READPAST, ROWLOCK)
      WHERE Status = 'QUEUED'
      ORDER BY CreatedAt
    )
  `);
  return result.recordset[0] ?? null;
}

async function completeJob(jobId: number, result: unknown): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("JobId", sql.BigInt, jobId)
    .input("Result", sql.NVarChar(sql.MAX), JSON.stringify(result ?? null))
    .query(`
      UPDATE [system].BackgroundJob
      SET Status = 'COMPLETED', Result = @Result, CompletedAt = SYSUTCDATETIME()
      WHERE JobId = @JobId
    `);
}

async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const pool = await getPool();
  const willRetry = job.Attempts < job.MaxAttempts;
  await pool
    .request()
    .input("JobId", sql.BigInt, job.JobId)
    .input("ErrorMessage", sql.NVarChar(sql.MAX), error instanceof Error ? error.message : String(error))
    .input("Status", sql.VarChar(20), willRetry ? "QUEUED" : "FAILED")
    .query(`
      UPDATE [system].BackgroundJob
      SET Status = @Status, ErrorMessage = @ErrorMessage, CompletedAt = CASE WHEN @Status = 'FAILED' THEN SYSUTCDATETIME() ELSE NULL END
      WHERE JobId = @JobId
    `);
}

export interface JobWorkerHandle {
  stop(): void;
}

/** In-process poller. One process is enough at Phase-1 scale; nothing here prevents running it in a dedicated worker process later. */
export function startJobWorker(pollIntervalMs = 2000): JobWorkerHandle {
  let stopped = false;
  let ticking = false;

  const timer = setInterval(() => {
    if (stopped || ticking) return;
    ticking = true;
    void tick().finally(() => {
      ticking = false;
    });
  }, pollIntervalMs);

  async function tick(): Promise<void> {
    let job: ClaimedJob | null;
    try {
      job = await claimNextJob();
    } catch (err) {
      logger.warn({ err }, "Background job poll failed (database likely unavailable)");
      return;
    }
    if (!job) return;

    const handler = handlers.get(job.JobType);
    if (!handler) {
      await failJob(job, new Error(`No handler registered for job type "${job.JobType}"`));
      return;
    }

    try {
      const payload = job.Payload ? JSON.parse(job.Payload) : null;
      const result = await handler(payload);
      await completeJob(job.JobId, result);
    } catch (err) {
      logger.error({ err, jobId: job.JobId, jobType: job.JobType }, "Background job failed");
      await failJob(job, err);
    }
  }

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
