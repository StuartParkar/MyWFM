import { Router } from "express";
import { z } from "zod";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { NotFoundError } from "../../errors/AppError.js";
import * as repo from "./formula.repository.js";
import { getCalculationLineage } from "./formula.service.js";

export const formulaRouter = Router();

formulaRouter.use(requireAuth, requirePermission("formula.view"));

formulaRouter.get("/", async (_req, res) => {
  const formulas = await repo.listActiveFormulas();
  res.json({ success: true, data: formulas } satisfies ApiSuccess<typeof formulas>);
});

const ledgerQuerySchema = z.object({
  formulaCode: z.string().max(50).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

formulaRouter.get("/ledger", async (req, res) => {
  const input = ledgerQuerySchema.parse(req.query);
  const result = await repo.listCalculationHistory(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

/** Data Lineage (build spec section 23): one Calculation Ledger row's full InputsSnapshot plus,
 * when SourceReference names one, the real import run(s) behind it. */
formulaRouter.get("/ledger/:id", async (req, res) => {
  const id = Number(req.params.id);
  const lineage = await getCalculationLineage(id);
  if (!lineage) throw new NotFoundError("Calculation not found.");
  res.json({ success: true, data: lineage } satisfies ApiSuccess<typeof lineage>);
});
