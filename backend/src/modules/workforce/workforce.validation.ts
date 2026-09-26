import { z } from "zod";

export const submitPlanSchema = z.object({
  businessMonth: z.string().regex(/^\d{4}-\d{2}-01$/, "businessMonth must be the 1st of a month (YYYY-MM-01)."),
  departmentId: z.coerce.number().int().positive().nullish(),
  processId: z.coerce.number().int().positive().nullish(),
  locationId: z.coerce.number().int().positive().nullish(),
  designationId: z.coerce.number().int().positive().nullish(),
  requiredHC: z.coerce.number().int().min(0),
  plannedHiresHC: z.coerce.number().int().min(0).default(0),
  plannedExitsHC: z.coerce.number().int().min(0).default(0),
  notes: z.string().trim().max(500).nullish(),
});

export const listPlansQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  processId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  designationId: z.coerce.number().int().positive().optional(),
});

export const scenarioInputSchema = z.object({
  scenarioName: z.string().trim().min(1, "Name is required.").max(200),
  processId: z.coerce.number().int().positive().nullish(),
  baselineFrom: z.string().date(),
  baselineTo: z.string().date(),
  volumeChangePct: z.coerce.number().min(-100).max(1000).default(0),
  ahtChangePct: z.coerce.number().min(-100).max(1000).default(0),
  shrinkagePctOverride: z.coerce.number().min(0).max(100).nullish(),
  hcChange: z.coerce.number().int().min(-10000).max(10000).default(0),
  notes: z.string().trim().max(500).nullish(),
});
