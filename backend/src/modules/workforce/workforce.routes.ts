import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as service from "./workforce.service.js";
import { listPlansQuerySchema, scenarioInputSchema, submitPlanSchema } from "./workforce.validation.js";

export const workforceRouter = Router();

workforceRouter.use(requireAuth);

workforceRouter.get("/plans", requirePermission("workforce.planning.view"), async (req, res) => {
  const input = listPlansQuerySchema.parse(req.query);
  const result = await service.listPlansWithProjection(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

workforceRouter.post("/plans", requirePermission("workforce.planning.manage"), async (req, res) => {
  const input = submitPlanSchema.parse(req.body);
  const id = await service.submitPlan({
    businessMonth: input.businessMonth,
    departmentId: input.departmentId ?? null,
    processId: input.processId ?? null,
    locationId: input.locationId ?? null,
    designationId: input.designationId ?? null,
    requiredHC: input.requiredHC,
    plannedHiresHC: input.plannedHiresHC,
    plannedExitsHC: input.plannedExitsHC,
    notes: input.notes ?? null,
    createdByUserId: req.user!.userId,
  });
  res.status(201).json({ success: true, data: { workforcePlanId: id } } satisfies ApiSuccess<{ workforcePlanId: number }>);
});

workforceRouter.get("/scenarios", requirePermission("scenario.view"), async (_req, res) => {
  const result = await service.listScenarios();
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

workforceRouter.get("/scenarios/:id/evaluate", requirePermission("scenario.view"), async (req, res) => {
  const id = Number(req.params.id);
  const result = await service.evaluateScenario(id);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

workforceRouter.post("/scenarios/preview", requirePermission("scenario.view"), async (req, res) => {
  const input = scenarioInputSchema.parse(req.body);
  const result = await service.previewScenario({
    scenarioName: input.scenarioName,
    processId: input.processId ?? null,
    baselineFrom: input.baselineFrom,
    baselineTo: input.baselineTo,
    volumeChangePct: input.volumeChangePct,
    ahtChangePct: input.ahtChangePct,
    shrinkagePctOverride: input.shrinkagePctOverride ?? null,
    hcChange: input.hcChange,
    notes: input.notes ?? null,
  });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

workforceRouter.post("/scenarios", requirePermission("scenario.manage"), async (req, res) => {
  const input = scenarioInputSchema.parse(req.body);
  const id = await service.createScenario({
    scenarioName: input.scenarioName,
    processId: input.processId ?? null,
    baselineFrom: input.baselineFrom,
    baselineTo: input.baselineTo,
    volumeChangePct: input.volumeChangePct,
    ahtChangePct: input.ahtChangePct,
    shrinkagePctOverride: input.shrinkagePctOverride ?? null,
    hcChange: input.hcChange,
    notes: input.notes ?? null,
    createdByUserId: req.user!.userId,
  });
  res.status(201).json({ success: true, data: { scenarioId: id } } satisfies ApiSuccess<{ scenarioId: number }>);
});

workforceRouter.patch("/scenarios/:id", requirePermission("scenario.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const input = scenarioInputSchema.parse(req.body);
  await service.updateScenario(
    id,
    {
      scenarioName: input.scenarioName,
      processId: input.processId ?? null,
      baselineFrom: input.baselineFrom,
      baselineTo: input.baselineTo,
      volumeChangePct: input.volumeChangePct,
      ahtChangePct: input.ahtChangePct,
      shrinkagePctOverride: input.shrinkagePctOverride ?? null,
      hcChange: input.hcChange,
      notes: input.notes ?? null,
    },
    req.user!.userId,
  );
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

workforceRouter.delete("/scenarios/:id", requirePermission("scenario.manage"), async (req, res) => {
  const id = Number(req.params.id);
  await service.deleteScenario(id, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});
