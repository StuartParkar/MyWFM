import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as service from "./reprocessing.service.js";
import { reprocessRequestSchema, reprocessingHistoryQuerySchema } from "./reprocessing.validation.js";

export const reprocessingRouter = Router();

reprocessingRouter.use(requireAuth);

reprocessingRouter.get("/", requirePermission("reprocessing.view"), async (req, res) => {
  const input = reprocessingHistoryQuerySchema.parse(req.query);
  const result = await service.listReprocessingRequests(input.page, input.pageSize);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

reprocessingRouter.post("/", requirePermission("reprocessing.execute"), async (req, res) => {
  const input = reprocessRequestSchema.parse(req.body);
  const row = await service.runReprocessing(input, req.user!.userId);
  res.status(201).json({ success: true, data: row } satisfies ApiSuccess<typeof row>);
});
