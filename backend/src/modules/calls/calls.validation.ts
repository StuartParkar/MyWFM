import { z } from "zod";

export const queueIntervalQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  queueId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

export const agentIntervalQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  agentId: z.string().uuid().optional(),
  queueId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
