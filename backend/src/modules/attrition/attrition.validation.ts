import { z } from "zod";

export const attritionQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  departmentId: z.coerce.number().int().positive().optional(),
  processId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  designationId: z.coerce.number().int().positive().optional(),
});
