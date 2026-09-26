import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { NotFoundError } from "../../errors/AppError.js";
import { recordAudit } from "../audit/audit.service.js";
import { toRequestContext } from "../../middleware/requestContext.js";
import * as repo from "./masterdata.repository.js";
import {
  codeNameSchema,
  createEmployeeSchema,
  createHolidaySchema,
  createShiftSchema,
  idParamSchema,
  nameOnlySchema,
  setQueueProcessSchema,
  updateEmployeeSchema,
} from "./masterdata.validation.js";

export const masterDataRouter = Router();

masterDataRouter.use(requireAuth, requirePermission("masterdata.view"));

masterDataRouter.get("/employees", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
  const locationId = req.query.locationId ? Number(req.query.locationId) : undefined;

  const result = await repo.listEmployees({ page, pageSize, search, departmentId, locationId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

masterDataRouter.get("/locations", async (_req, res) => {
  res.json({ success: true, data: await repo.listLocations() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/departments", async (_req, res) => {
  res.json({ success: true, data: await repo.listDepartments() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/processes", async (_req, res) => {
  res.json({ success: true, data: await repo.listProcesses() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/designations", async (_req, res) => {
  res.json({ success: true, data: await repo.listDesignations() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/shifts", async (_req, res) => {
  res.json({ success: true, data: await repo.listShifts() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/queues", async (_req, res) => {
  res.json({ success: true, data: await repo.listQueues() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/skills", async (_req, res) => {
  res.json({ success: true, data: await repo.listSkills() } satisfies ApiSuccess<unknown>);
});

// Powers the Global Filter Bar's HOD -> TL -> Agent/Senior cascade (build spec section 8).
masterDataRouter.get("/lookups/hods", async (_req, res) => {
  res.json({ success: true, data: await repo.listUnitHods() } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/lookups/tls", async (req, res) => {
  const hodId = String(req.query.hodId ?? "");
  const data = hodId ? await repo.listTeamLeadersUnderHod(hodId) : [];
  res.json({ success: true, data } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/lookups/agents", async (req, res) => {
  const tlId = String(req.query.tlId ?? "");
  const data = tlId ? await repo.listAgentsUnderTeamLeader(tlId) : [];
  res.json({ success: true, data } satisfies ApiSuccess<unknown>);
});

masterDataRouter.get("/holidays", async (_req, res) => {
  res.json({ success: true, data: await repo.listHolidays() } satisfies ApiSuccess<unknown>);
});

// ---------------------------------------------------------------------------
// Writes - masterdata.manage. Every write is audited (build spec section 44).
// ---------------------------------------------------------------------------
const manage = requirePermission("masterdata.manage");

masterDataRouter.post("/employees", manage, async (req, res) => {
  const input = createEmployeeSchema.parse(req.body);
  const employeeId = await repo.createEmployee(input);
  await recordAudit({
    entityType: "Employee",
    entityId: employeeId,
    action: "CREATE",
    performedByUserId: req.user!.userId,
    after: input,
    ...toRequestContext(req),
  });
  res.status(201).json({ success: true, data: { employeeId } } satisfies ApiSuccess<{ employeeId: string }>);
});

masterDataRouter.patch("/employees/:employeeId", manage, async (req, res) => {
  const employeeId = String(req.params.employeeId);
  const input = updateEmployeeSchema.parse(req.body);
  const before = await repo.getEmployeeSnapshot(employeeId);
  if (!before) throw new NotFoundError("Employee not found.");

  await repo.updateEmployee(employeeId, input);
  const after = await repo.getEmployeeSnapshot(employeeId);
  await recordAudit({
    entityType: "Employee",
    entityId: employeeId,
    action: "UPDATE",
    performedByUserId: req.user!.userId,
    before,
    after,
    ...toRequestContext(req),
  });
  res.status(204).send();
});

function registerSimpleLookupWriteRoutes(
  path: string,
  entityType: string,
  create: (code: string, name: string) => Promise<number>,
  deactivate: (id: number) => Promise<void>,
) {
  masterDataRouter.post(`/${path}`, manage, async (req, res) => {
    const input = codeNameSchema.parse(req.body);
    const id = await create(input.code, input.name);
    await recordAudit({ entityType, entityId: String(id), action: "CREATE", performedByUserId: req.user!.userId, after: input, ...toRequestContext(req) });
    res.status(201).json({ success: true, data: { id } } satisfies ApiSuccess<{ id: number }>);
  });
  masterDataRouter.patch(`/${path}/:id`, manage, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await deactivate(id);
    await recordAudit({ entityType, entityId: String(id), action: "DEACTIVATE", performedByUserId: req.user!.userId, ...toRequestContext(req) });
    res.status(204).send();
  });
}

registerSimpleLookupWriteRoutes("locations", "Location", repo.createLocation, repo.deactivateLocation);
registerSimpleLookupWriteRoutes("processes", "Process", repo.createProcess, repo.deactivateProcess);
registerSimpleLookupWriteRoutes("queues", "Queue", repo.createQueue, repo.deactivateQueue);
registerSimpleLookupWriteRoutes("skills", "Skill", repo.createSkill, repo.deactivateSkill);

// Queue is the only simple lookup with a field worth editing after creation: ProcessId is how
// Calls workload attributes to a roster requirement's process for the workload-derived
// Staffing formulas (build spec section 19) - auto-created queues from a Calls import start
// with no process, since nothing in the source files says which process a queue belongs to.
masterDataRouter.patch("/queues/:id/process", manage, async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  const { processId } = setQueueProcessSchema.parse(req.body);
  await repo.setQueueProcess(id, processId);
  await recordAudit({ entityType: "Queue", entityId: String(id), action: "UPDATE", performedByUserId: req.user!.userId, after: { processId }, ...toRequestContext(req) });
  res.status(204).send();
});

masterDataRouter.post("/departments", manage, async (req, res) => {
  const input = nameOnlySchema.parse(req.body);
  const id = await repo.createDepartment(input.name);
  await recordAudit({ entityType: "Department", entityId: String(id), action: "CREATE", performedByUserId: req.user!.userId, after: input, ...toRequestContext(req) });
  res.status(201).json({ success: true, data: { id } } satisfies ApiSuccess<{ id: number }>);
});
masterDataRouter.patch("/departments/:id", manage, async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  await repo.deactivateDepartment(id);
  await recordAudit({ entityType: "Department", entityId: String(id), action: "DEACTIVATE", performedByUserId: req.user!.userId, ...toRequestContext(req) });
  res.status(204).send();
});

masterDataRouter.post("/shifts", manage, async (req, res) => {
  const input = createShiftSchema.parse(req.body);
  const id = await repo.createShift(input);
  await recordAudit({ entityType: "Shift", entityId: String(id), action: "CREATE", performedByUserId: req.user!.userId, after: input, ...toRequestContext(req) });
  res.status(201).json({ success: true, data: { id } } satisfies ApiSuccess<{ id: number }>);
});
masterDataRouter.patch("/shifts/:id", manage, async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  await repo.deactivateShift(id);
  await recordAudit({ entityType: "Shift", entityId: String(id), action: "DEACTIVATE", performedByUserId: req.user!.userId, ...toRequestContext(req) });
  res.status(204).send();
});

masterDataRouter.post("/holidays", manage, async (req, res) => {
  const input = createHolidaySchema.parse(req.body);
  const id = await repo.createHoliday(input);
  await recordAudit({ entityType: "Holiday", entityId: String(id), action: "CREATE", performedByUserId: req.user!.userId, after: input, ...toRequestContext(req) });
  res.status(201).json({ success: true, data: { id } } satisfies ApiSuccess<{ id: number }>);
});
masterDataRouter.patch("/holidays/:id", manage, async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  await repo.deactivateHoliday(id);
  await recordAudit({ entityType: "Holiday", entityId: String(id), action: "DEACTIVATE", performedByUserId: req.user!.userId, ...toRequestContext(req) });
  res.status(204).send();
});
