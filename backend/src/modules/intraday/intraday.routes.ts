import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { ForbiddenError } from "../../errors/AppError.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as repo from "./intraday.repository.js";
import * as service from "./intraday.service.js";
import {
  capacityImpactQuerySchema,
  createCapacityRequestSchema,
  decideCapacityRequestSchema,
  endBreakSchema,
  intervalSummaryQuerySchema,
  listBreaksQuerySchema,
  listCapacityRequestsQuerySchema,
  listExceptionsQuerySchema,
  recordExceptionActionSchema,
  resolveExceptionSchema,
  scanExceptionsSchema,
  scheduledEmployeesQuerySchema,
  startBreakSchema,
} from "./intraday.validation.js";

export const intradayRouter = Router();

intradayRouter.use(requireAuth, requirePermission("intraday.view"));

intradayRouter.get("/interval-summary", async (req, res) => {
  const input = intervalSummaryQuerySchema.parse(req.query);
  const result = await service.getIntervalSummary({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

intradayRouter.get("/breaks", async (req, res) => {
  const input = listBreaksQuerySchema.parse(req.query);
  const result = await service.listBreaks(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

intradayRouter.get("/breaks/scheduled-employees", async (req, res) => {
  const input = scheduledEmployeesQuerySchema.parse(req.query);
  const result = await repo.listScheduledEmployeesForDate(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

intradayRouter.post("/breaks", requirePermission("intraday.manage"), async (req, res) => {
  const input = startBreakSchema.parse(req.body);
  const id = await service.startBreak({ ...input, createdByUserId: req.user!.userId });
  res.status(201).json({ success: true, data: { breakSessionId: id } } satisfies ApiSuccess<{ breakSessionId: number }>);
});

intradayRouter.patch("/breaks/:id/end", requirePermission("intraday.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const input = endBreakSchema.parse(req.body);
  await service.endBreak(id, input.breakEnd, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

intradayRouter.get("/exceptions", async (req, res) => {
  const input = listExceptionsQuerySchema.parse(req.query);
  const result = await service.listExceptions(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

intradayRouter.post("/exceptions/scan", requirePermission("intraday.manage"), async (req, res) => {
  const input = scanExceptionsSchema.parse(req.body);
  const result = await service.scanForExceptions({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

intradayRouter.patch("/exceptions/:id/acknowledge", requirePermission("intraday.manage"), async (req, res) => {
  const id = Number(req.params.id);
  await service.acknowledgeException(id, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

intradayRouter.patch("/exceptions/:id/action", requirePermission("intraday.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const input = recordExceptionActionSchema.parse(req.body);
  await service.recordExceptionAction(id, input.actionTaken, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

intradayRouter.patch("/exceptions/:id/resolve", requirePermission("intraday.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const input = resolveExceptionSchema.parse(req.body);
  await service.resolveException(id, input.resolutionNotes ?? null, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

intradayRouter.get("/capacity-requests", async (req, res) => {
  const input = listCapacityRequestsQuerySchema.parse(req.query);
  const result = await service.listCapacityRequests(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

intradayRouter.get("/capacity-requests/impact", async (req, res) => {
  const input = capacityImpactQuerySchema.parse(req.query);
  const result = await service.getCapacityImpact({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

// Either intraday.request (submit your own) or intraday.manage (submit for anyone) is enough -
// requirePermission only expresses AND, so the OR is checked inline here.
intradayRouter.post("/capacity-requests", (req, res, next) => {
  if (!req.user!.permissions.includes("intraday.request") && !req.user!.permissions.includes("intraday.manage")) {
    throw new ForbiddenError("Missing required permission(s): intraday.request or intraday.manage");
  }
  next();
}, async (req, res) => {
  const input = createCapacityRequestSchema.parse(req.body);
  const canActForOthers = req.user!.permissions.includes("intraday.manage");
  const id = await service.createCapacityRequest({ ...input, reason: input.reason ?? null, requestedByUserId: req.user!.userId, canActForOthers });
  res.status(201).json({ success: true, data: { requestId: id } } satisfies ApiSuccess<{ requestId: number }>);
});

intradayRouter.patch("/capacity-requests/:id/approve", requirePermission("intraday.approve"), async (req, res) => {
  const id = Number(req.params.id);
  const input = decideCapacityRequestSchema.parse(req.body);
  await service.decideCapacityRequest(id, "APPROVED", input.decisionNotes ?? null, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

intradayRouter.patch("/capacity-requests/:id/reject", requirePermission("intraday.approve"), async (req, res) => {
  const id = Number(req.params.id);
  const input = decideCapacityRequestSchema.parse(req.body);
  await service.decideCapacityRequest(id, "REJECTED", input.decisionNotes ?? null, req.user!.userId);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});

intradayRouter.patch("/capacity-requests/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  const canActForOthers = req.user!.permissions.includes("intraday.manage");
  await service.cancelCapacityRequest(id, req.user!.userId, canActForOthers);
  res.json({ success: true, data: null } satisfies ApiSuccess<null>);
});
