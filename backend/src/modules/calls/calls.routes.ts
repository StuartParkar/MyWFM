import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as repo from "./calls.repository.js";
import { agentIntervalQuerySchema, queueIntervalQuerySchema } from "./calls.validation.js";

export const callsRouter = Router();

callsRouter.use(requireAuth, requirePermission("calls.view"));

callsRouter.get("/queue-intervals", async (req, res) => {
  const input = queueIntervalQuerySchema.parse(req.query);
  const result = await repo.listQueueIntervals(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

callsRouter.get("/agent-intervals", async (req, res) => {
  const input = agentIntervalQuerySchema.parse(req.query);
  const result = await repo.listAgentIntervals(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
