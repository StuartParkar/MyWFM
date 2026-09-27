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

// listCallMetricsRaw (callMetrics.repository.ts) has no server-side row cap - it
// returns one grouped row per (date, queue|process) with no TOP/pagination. On
// calls.QueueIntervalCall/AgentIntervalCall (the tables the architecture doc
// calls out as headed toward millions of rows), an unbounded range is an
// unbounded scan. 366 days covers any legitimate reporting need (a full year,
// even a leap one) while capping the worst case.
const MAX_METRICS_RANGE_DAYS = 366;

function withinMaxRange<T extends { from: string; to: string }>(schema: z.ZodType<T>) {
  return schema.refine(
    ({ from, to }) => {
      const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
      return days >= 0 && days <= MAX_METRICS_RANGE_DAYS;
    },
    { message: `The date range cannot exceed ${MAX_METRICS_RANGE_DAYS} days.`, path: ["to"] },
  );
}

export const callMetricsByQueueQuerySchema = withinMaxRange(
  z.object({
    from: z.string().date(),
    to: z.string().date(),
    queueId: z.coerce.number().int().positive().optional(),
  }),
);

export const callMetricsByProcessQuerySchema = withinMaxRange(
  z.object({
    from: z.string().date(),
    to: z.string().date(),
    processId: z.coerce.number().int().positive().optional(),
  }),
);
