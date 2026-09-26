import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import type { PermissionCode } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { recordAudit } from "../audit/audit.service.js";
import { toRequestContext } from "../../middleware/requestContext.js";
import * as repo from "./roster.repository.js";
import * as service from "./roster.service.js";
import { assignmentSchema, createRequirementSchema, impactPreviewSchema, reviewSchema, rosterChangeSchema } from "./roster.validation.js";

export const rosterRouter = Router();

rosterRouter.use(requireAuth, requirePermission("roster.view" as PermissionCode));

rosterRouter.get("/requirements", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const status = typeof req.query.status === "string" ? (req.query.status as repo.RequirementStatus) : undefined;
  const businessDateFrom = typeof req.query.from === "string" ? req.query.from : undefined;
  const businessDateTo = typeof req.query.to === "string" ? req.query.to : undefined;
  const result = await repo.listRequirements({ status, businessDateFrom, businessDateTo, page, pageSize });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

rosterRouter.get("/requirements/:id", async (req, res) => {
  const id = Number(req.params.id);
  const requirement = await repo.getRequirement(id);
  const actions = await repo.listRequirementActions(id);
  const assignments = await repo.listAssignments(id);
  res.json({ success: true, data: { requirement, actions, assignments } } satisfies ApiSuccess<unknown>);
});

rosterRouter.post("/requirements", requirePermission("roster.submit"), async (req, res) => {
  const input = createRequirementSchema.parse(req.body);
  const requirementId = await service.submitRequirement({ ...input, requestedByUserId: req.user!.userId });
  res.status(201).json({ success: true, data: { requirementId } } satisfies ApiSuccess<{ requirementId: number }>);
});

// Review permission is decided by the requirement's current status inside
// roster.service.ts, not by a single fixed permission on this route - a
// Leader, HOD and WFM user all call the same endpoint.
rosterRouter.post("/requirements/:id/review", async (req, res) => {
  const id = Number(req.params.id);
  const input = reviewSchema.parse(req.body);
  await service.reviewRequirement(id, input.decision, input.comments ?? null, req.user!.userId, req.user!.permissions);
  res.status(204).send();
});

rosterRouter.post("/requirements/:id/assignments", requirePermission("roster.review.leader"), async (req, res) => {
  const id = Number(req.params.id);
  const input = assignmentSchema.parse(req.body);
  await repo.addAssignment(id, input.employeeId, req.user!.userId);
  await recordAudit({ entityType: "RosterRequirement", entityId: String(id), action: "ASSIGN_EMPLOYEE", performedByUserId: req.user!.userId, after: input, ...toRequestContext(req) });
  res.status(201).send();
});

rosterRouter.delete("/requirements/:id/assignments/:employeeId", requirePermission("roster.review.leader"), async (req, res) => {
  const id = Number(req.params.id);
  const employeeId = String(req.params.employeeId);
  await repo.removeAssignment(id, employeeId);
  await recordAudit({ entityType: "RosterRequirement", entityId: String(id), action: "UNASSIGN_EMPLOYEE", performedByUserId: req.user!.userId, after: { employeeId }, ...toRequestContext(req) });
  res.status(204).send();
});

rosterRouter.get("/published", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!from || !to) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "from and to are required.", errorId: "n/a" } });
    return;
  }
  const result = await repo.listPublishedRoster({ businessDateFrom: from, businessDateTo: to, page, pageSize });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

rosterRouter.get("/change-impact", requirePermission("roster.change"), async (req, res) => {
  const input = impactPreviewSchema.parse(req.query);
  const impact = await repo.simulateShiftChangeImpact(input.employeeId, input.businessDate, input.newShiftId);
  res.json({ success: true, data: impact } satisfies ApiSuccess<unknown>);
});

rosterRouter.post("/changes", requirePermission("roster.change"), async (req, res) => {
  const input = rosterChangeSchema.parse(req.body);
  const changeId = await repo.createRosterChange({ ...input, requestedByUserId: req.user!.userId });
  await recordAudit({ entityType: "RosterChange", entityId: String(changeId), action: "CREATE", performedByUserId: req.user!.userId, after: input, ...toRequestContext(req) });
  res.status(201).json({ success: true, data: { changeId } } satisfies ApiSuccess<{ changeId: number }>);
});

rosterRouter.get("/changes", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const result = await repo.listRosterChanges(page, pageSize);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
