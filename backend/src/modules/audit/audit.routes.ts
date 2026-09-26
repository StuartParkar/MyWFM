import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { listRecentAudit, type AuditListItem } from "./audit.service.js";

export const auditRouter = Router();

auditRouter.get("/", requireAuth, requirePermission("audit.view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const items = await listRecentAudit(limit);
  const body: ApiSuccess<AuditListItem[]> = { success: true, data: items };
  res.status(200).json(body);
});
