import { Router } from "express";
import { z } from "zod";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { getHealthReport } from "./health.service.js";
import { listHealthSnapshots } from "./health.repository.js";

export const healthRouter = Router();

/**
 * Unauthenticated liveness probe (container orchestration, load balancers).
 * Deliberately returns only "is the process alive", not database detail -
 * that requires system.health.view and lives at GET /api/system-health/detail.
 */
healthRouter.get("/", (_req, res) => {
  res.status(200).json({ success: true, data: { status: "UP" } } satisfies ApiSuccess<{ status: "UP" }>);
});

healthRouter.get("/detail", requireAuth, requirePermission("system.health.view"), async (_req, res) => {
  const report = await getHealthReport();
  const body: ApiSuccess<typeof report> = { success: true, data: report };
  res.status(200).json(body);
});

const historyQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * Phase 11: real persisted history (healthSnapshotSampler.ts) behind the same
 * permission as the live snapshot above - defaults to the trailing 24 hours,
 * since that's also the window the live snapshot's own "failed last 24h"
 * figure already uses.
 */
healthRouter.get("/history", requireAuth, requirePermission("system.health.view"), async (req, res) => {
  const input = historyQuerySchema.parse(req.query);
  const to = input.to ?? new Date().toISOString();
  const from = input.from ?? new Date(Date.parse(to) - 24 * 60 * 60 * 1000).toISOString();
  const snapshots = await listHealthSnapshots(from, to);
  res.json({ success: true, data: snapshots } satisfies ApiSuccess<typeof snapshots>);
});
