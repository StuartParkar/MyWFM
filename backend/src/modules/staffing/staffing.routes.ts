import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as service from "./staffing.service.js";
import { coverageQuerySchema } from "./staffing.validation.js";

export const staffingRouter = Router();

staffingRouter.use(requireAuth, requirePermission("staffing.view"));

staffingRouter.get("/coverage", async (req, res) => {
  const input = coverageQuerySchema.parse(req.query);
  const result = await service.listCoverage({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
