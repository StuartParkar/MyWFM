import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as repo from "./shrinkage.repository.js";
import * as service from "./shrinkage.service.js";
import { createEntrySchema, dailyShrinkageQuerySchema, deleteEntrySchema, entriesQuerySchema, updateEntrySchema } from "./shrinkage.validation.js";

export const shrinkageRouter = Router();

shrinkageRouter.use(requireAuth, requirePermission("shrinkage.view"));

shrinkageRouter.get("/categories", async (_req, res) => {
  const categories = await repo.listCategories();
  res.json({ success: true, data: categories } satisfies ApiSuccess<typeof categories>);
});

shrinkageRouter.get("/entries", async (req, res) => {
  const input = entriesQuerySchema.parse(req.query);
  const entries = await repo.listEntriesForRange(input.employeeId, input.businessDate, input.businessDate);
  res.json({ success: true, data: entries } satisfies ApiSuccess<typeof entries>);
});

shrinkageRouter.get("/", async (req, res) => {
  const input = dailyShrinkageQuerySchema.parse(req.query);
  const result = await service.listDailyShrinkage({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

shrinkageRouter.post("/entries", requirePermission("shrinkage.manage"), async (req, res) => {
  const input = createEntrySchema.parse(req.body);
  const shrinkageEntryId = await service.recordEntry({ ...input, recordedByUserId: req.user!.userId });
  res.status(201).json({ success: true, data: { shrinkageEntryId } } satisfies ApiSuccess<{ shrinkageEntryId: number }>);
});

shrinkageRouter.patch("/entries/:id", requirePermission("shrinkage.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason, ...patch } = updateEntrySchema.parse(req.body);
  await service.adjustEntry(id, patch, reason, req.user!.userId);
  res.status(204).send();
});

shrinkageRouter.delete("/entries/:id", requirePermission("shrinkage.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = deleteEntrySchema.parse(req.body);
  await service.removeEntry(id, reason, req.user!.userId);
  res.status(204).send();
});
