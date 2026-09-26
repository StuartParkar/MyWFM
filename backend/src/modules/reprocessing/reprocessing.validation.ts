import { z } from "zod";

const reason = z.string().trim().min(1, "A reason is required to run reprocessing.").max(500);
const from = z.string().date();
const to = z.string().date();
const dimensionId = z.coerce.number().int().positive().optional();

/**
 * One variant per real, already-ledger-writing calculation this system has (Shrinkage,
 * Staffing's two grains, Calls' two grains, Forecast, Attrition Rate) - each carrying only the
 * dimension filters that calculation's own real service function actually supports (see
 * reprocessing.service.ts's dispatch). Deliberately not a generic "any calculationType + any
 * filters" shape - that would let a request claim a scope the underlying calculation can't
 * actually honor.
 */
export const reprocessRequestSchema = z.discriminatedUnion("calculationType", [
  z.object({ calculationType: z.literal("SHRINKAGE"), from, to, employeeId: z.string().uuid().optional(), reason }),
  z.object({ calculationType: z.literal("STAFFING_COVERAGE"), from, to, departmentId: dimensionId, processId: dimensionId, reason }),
  z.object({ calculationType: z.literal("STAFFING_CAPACITY"), from, to, processId: dimensionId, reason }),
  z.object({ calculationType: z.literal("CALLS_BY_QUEUE"), from, to, queueId: dimensionId, reason }),
  z.object({ calculationType: z.literal("CALLS_BY_PROCESS"), from, to, processId: dimensionId, reason }),
  z.object({ calculationType: z.literal("FORECAST"), from, to, queueId: dimensionId, reason }),
  z.object({ calculationType: z.literal("ATTRITION"), from, to, departmentId: dimensionId, processId: dimensionId, locationId: dimensionId, designationId: dimensionId, reason }),
]);
export type ReprocessRequest = z.infer<typeof reprocessRequestSchema>;

export const reprocessingHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
