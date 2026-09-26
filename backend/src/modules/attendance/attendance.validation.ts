import { z } from "zod";

export const createSessionSchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
  sessionStart: z.string().datetime({ offset: true }),
  sessionEnd: z.string().datetime({ offset: true }).nullish(),
  breakMinutes: z.number().int().min(0).default(0),
  reason: z.string().trim().max(500).nullish(),
});

export const updateSessionSchema = z
  .object({
    sessionStart: z.string().datetime({ offset: true }).optional(),
    sessionEnd: z.string().datetime({ offset: true }).nullish(),
    breakMinutes: z.number().int().min(0).optional(),
    reason: z.string().trim().min(1, "A reason is required to adjust an attendance session.").max(500),
  })
  .refine((v) => v.sessionStart !== undefined || v.sessionEnd !== undefined || v.breakMinutes !== undefined, {
    message: "At least one of sessionStart, sessionEnd or breakMinutes must be provided.",
  });

export const deleteSessionSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to remove an attendance session.").max(500),
});

export const sessionsQuerySchema = z.object({
  employeeId: z.string().uuid(),
  businessDate: z.string().date(),
});

export const dailySummaryQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  from: z.string().date(),
  to: z.string().date(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
