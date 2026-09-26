import { z } from "zod";

export const coverageQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  departmentId: z.coerce.number().int().positive().optional(),
  processId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const capacityQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  processId: z.coerce.number().int().positive().optional(),
});
