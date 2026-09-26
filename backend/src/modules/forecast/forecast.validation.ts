import { z } from "zod";

export const forecastQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  queueId: z.coerce.number().int().positive().optional(),
});
