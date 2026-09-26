import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as service from "./controlTower.service.js";
import { controlTowerQuerySchema } from "./controlTower.validation.js";

export const controlTowerRouter = Router();

controlTowerRouter.use(requireAuth, requirePermission("controltower.view"));

controlTowerRouter.get("/summary", async (req, res) => {
  const input = controlTowerQuerySchema.parse(req.query);
  const result = await service.getSummary({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
