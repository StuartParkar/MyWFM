import { z } from "zod";

export const intervalSummaryQuerySchema = z.object({
  businessDate: z.string().date(),
  processId: z.coerce.number().int().positive().optional(),
});

export const startBreakSchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
  breakStart: z.string().datetime({ offset: true }),
});

export const endBreakSchema = z.object({
  breakEnd: z.string().datetime({ offset: true }),
});

export const listBreaksQuerySchema = z.object({
  businessDate: z.string().date(),
  processId: z.coerce.number().int().positive().optional(),
});

export const scheduledEmployeesQuerySchema = z.object({
  businessDate: z.string().date(),
  processId: z.coerce.number().int().positive().optional(),
});

export const scanExceptionsSchema = z.object({
  businessDate: z.string().date(),
  processId: z.coerce.number().int().positive().optional(),
});

export const listExceptionsQuerySchema = z.object({
  status: z.enum(["DETECTED", "ACKNOWLEDGED", "ACTION_TAKEN", "RESOLVED"]).optional(),
  excludeResolved: z.coerce.boolean().optional(),
  category: z.enum(["STAFFING", "SERVICE_LEVEL", "ATTENDANCE", "DATA_QUALITY"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const recordExceptionActionSchema = z.object({
  actionTaken: z.string().trim().min(1, "Describe the action taken.").max(500),
});

export const resolveExceptionSchema = z.object({
  resolutionNotes: z.string().trim().max(500).nullish(),
});

export const createCapacityRequestSchema = z.object({
  requestType: z.enum(["OVERTIME", "VTO"]),
  // Optional: a plain intraday.request-only user's employeeId is always resolved server-side
  // from their own account, never trusted from the body - see intraday.service.ts's
  // createCapacityRequest. Only a canActForOthers caller (intraday.manage) may set this.
  employeeId: z.string().uuid().optional(),
  businessDate: z.string().date(),
  hoursRequested: z.number().positive().max(24),
  reason: z.string().trim().max(300).nullish(),
});

export const listCapacityRequestsQuerySchema = z.object({
  businessDate: z.string().date().optional(),
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  employeeId: z.string().uuid().optional(),
});

export const decideCapacityRequestSchema = z.object({
  decisionNotes: z.string().trim().max(300).nullish(),
});

export const capacityImpactQuerySchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
  requestType: z.enum(["OVERTIME", "VTO"]),
  hoursRequested: z.coerce.number().positive().max(24),
});
