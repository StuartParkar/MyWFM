import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { toRequestContext } from "../../middleware/requestContext.js";
import { ConflictError, ValidationError } from "../../errors/AppError.js";
import { hashPassword, validatePasswordPolicy } from "../auth/password.js";
import { recordAudit } from "../audit/audit.service.js";
import * as repo from "./users.repository.js";
import { createUserSchema, setActiveSchema, setRolesSchema } from "./users.validation.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get("/", requirePermission("user.view"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const result = await repo.listUsers(page, pageSize, search);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

usersRouter.get("/roles", requirePermission("user.view"), async (_req, res) => {
  res.json({ success: true, data: await repo.listRoles() } satisfies ApiSuccess<unknown>);
});

usersRouter.post("/", requirePermission("user.manage"), async (req, res) => {
  const input = createUserSchema.parse(req.body);

  const policy = validatePasswordPolicy(input.password);
  if (!policy.valid) {
    throw new ValidationError("Password does not meet policy.", { password: policy.errors });
  }
  const existing = await repo.findUserByEmail(input.email);
  if (existing) throw new ConflictError(`A user with email "${input.email}" already exists.`);

  const passwordHash = await hashPassword(input.password);
  const userId = await repo.createUser({ email: input.email, passwordHash, displayName: input.displayName });
  await repo.setUserRoles(userId, input.roleCodes);

  await recordAudit({
    entityType: "User",
    entityId: userId,
    action: "CREATE",
    performedByUserId: req.user!.userId,
    after: { email: input.email, displayName: input.displayName, roleCodes: input.roleCodes },
    ...toRequestContext(req),
  });

  res.status(201).json({ success: true, data: { userId } } satisfies ApiSuccess<{ userId: string }>);
});

usersRouter.patch("/:userId/roles", requirePermission("role.manage"), async (req, res) => {
  const { userId } = req.params as { userId: string };
  const input = setRolesSchema.parse(req.body);
  await repo.setUserRoles(userId, input.roleCodes);
  await recordAudit({
    entityType: "User",
    entityId: userId,
    action: "ROLES_CHANGED",
    performedByUserId: req.user!.userId,
    after: input,
    ...toRequestContext(req),
  });
  res.status(204).send();
});

usersRouter.patch("/:userId/active", requirePermission("user.manage"), async (req, res) => {
  const { userId } = req.params as { userId: string };
  const input = setActiveSchema.parse(req.body);
  await repo.setUserActive(userId, input.isActive);
  await recordAudit({
    entityType: "User",
    entityId: userId,
    action: input.isActive ? "ACTIVATE" : "DEACTIVATE",
    performedByUserId: req.user!.userId,
    ...toRequestContext(req),
  });
  res.status(204).send();
});
