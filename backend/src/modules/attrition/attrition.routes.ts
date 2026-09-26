import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as service from "./attrition.service.js";
import { attritionQuerySchema } from "./attrition.validation.js";

export const attritionRouter = Router();

attritionRouter.use(requireAuth, requirePermission("attrition.view"));

attritionRouter.get("/summary", async (req, res) => {
  const input = attritionQuerySchema.parse(req.query);
  const result = await service.getSummary({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

attritionRouter.get("/joiners-exits", async (req, res) => {
  const input = attritionQuerySchema.parse(req.query);
  const result = await service.listJoinersAndExits(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

attritionRouter.get("/transfers", async (req, res) => {
  const input = attritionQuerySchema.parse(req.query);
  const result = await service.listTransfers(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
