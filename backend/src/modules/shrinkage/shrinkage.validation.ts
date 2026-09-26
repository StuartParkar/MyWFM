import { z } from "zod";

export const createEntrySchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
  shrinkageCategoryId: z.number().int().positive(),
  minutes: z.number().int().positive(),
  notes: z.string().trim().max(500).nullish(),
});

export const updateEntrySchema = z
  .object({
    minutes: z.number().int().positive().optional(),
    shrinkageCategoryId: z.number().int().positive().optional(),
    notes: z.string().trim().max(500).nullish(),
    reason: z.string().trim().min(1, "A reason is required to adjust a shrinkage entry.").max(500),
  })
  .refine((v) => v.minutes !== undefined || v.shrinkageCategoryId !== undefined || v.notes !== undefined, {
    message: "At least one of minutes, shrinkageCategoryId or notes must be provided.",
  });

export const deleteEntrySchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to remove a shrinkage entry.").max(500),
});

export const entriesQuerySchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
});

export const dailyShrinkageQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  from: z.string().date(),
  to: z.string().date(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
