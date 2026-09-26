import { z } from "zod";

export const controlTowerQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  processId: z.coerce.number().int().positive().optional(),
  hodId: z.string().uuid().optional(),
  tlId: z.string().uuid().optional(),
  agentSeniorId: z.string().uuid().optional(),
  designationCode: z.string().max(30).optional(),
});
