import { z } from "zod";

export const createEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(20),
  fullName: z.string().trim().min(1).max(200),
  aliasName: z.string().trim().max(100).nullish(),
  locationId: z.number().int().positive().nullish(),
  departmentId: z.number().int().positive().nullish(),
  designationId: z.number().int().positive().nullish(),
  joinDate: z.string().date().nullish(),
});

export const updateEmployeeSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  aliasName: z.string().trim().max(100).nullish(),
  locationId: z.number().int().positive().nullish(),
  departmentId: z.number().int().positive().nullish(),
  designationId: z.number().int().positive().nullish(),
  teamLeaderEmployeeId: z.string().uuid().nullish(),
  unitHodEmployeeId: z.string().uuid().nullish(),
  joinDate: z.string().date().nullish(),
  leftDate: z.string().date().nullish(),
  isActive: z.boolean().optional(),
});

export const codeNameSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
});

export const nameOnlySchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const createShiftSchema = z.object({
  shiftCode: z.string().trim().min(1).max(20),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)"),
  description: z.string().trim().max(200).nullish(),
});

export const createHolidaySchema = z.object({
  holidayDate: z.string().date(),
  holidayName: z.string().trim().min(1).max(150),
  locationId: z.number().int().positive().nullish(),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const setQueueProcessSchema = z.object({
  processId: z.number().int().positive().nullable(),
});
