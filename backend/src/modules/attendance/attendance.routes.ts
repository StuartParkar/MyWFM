import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as repo from "./attendance.repository.js";
import * as service from "./attendance.service.js";
import { createSessionSchema, dailySummaryQuerySchema, deleteSessionSchema, sessionsQuerySchema, updateSessionSchema } from "./attendance.validation.js";

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth, requirePermission("attendance.view"));

attendanceRouter.get("/", async (req, res) => {
  const input = dailySummaryQuerySchema.parse(req.query);
  const result = await service.listDailySummaries(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

attendanceRouter.get("/sessions", async (req, res) => {
  const input = sessionsQuerySchema.parse(req.query);
  const sessions = await repo.listSessionsForRange(input.employeeId, input.businessDate, input.businessDate);
  res.json({ success: true, data: sessions } satisfies ApiSuccess<typeof sessions>);
});

attendanceRouter.post("/sessions", requirePermission("attendance.manage"), async (req, res) => {
  const input = createSessionSchema.parse(req.body);
  const attendanceSessionId = await service.recordSession({ ...input, recordedByUserId: req.user!.userId });
  res.status(201).json({ success: true, data: { attendanceSessionId } } satisfies ApiSuccess<{ attendanceSessionId: number }>);
});

attendanceRouter.patch("/sessions/:id", requirePermission("attendance.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason, ...patch } = updateSessionSchema.parse(req.body);
  await service.adjustSession(id, patch, reason, req.user!.userId);
  res.status(204).send();
});

attendanceRouter.delete("/sessions/:id", requirePermission("attendance.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = deleteSessionSchema.parse(req.body);
  await service.removeSession(id, reason, req.user!.userId);
  res.status(204).send();
});
