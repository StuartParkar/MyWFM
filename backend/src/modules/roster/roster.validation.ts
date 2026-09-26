import { z } from "zod";

export const createRequirementSchema = z.object({
  businessDate: z.string().date(),
  locationId: z.number().int().positive().nullish(),
  processId: z.number().int().positive().nullish(),
  departmentId: z.number().int().positive().nullish(),
  shiftId: z.number().int().positive().nullish(),
  requiredHc: z.number().int().min(0),
  notes: z.string().trim().max(500).nullish(),
});

export const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "SEND_BACK"]),
  comments: z.string().trim().max(500).nullish(),
});

export const assignmentSchema = z.object({
  employeeId: z.string().uuid(),
});

export const rosterChangeSchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
  newShiftId: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});

export const impactPreviewSchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
  newShiftId: z.coerce.number().int().positive(),
});
