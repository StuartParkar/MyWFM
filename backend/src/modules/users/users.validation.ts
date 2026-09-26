import { z } from "zod";
import { ROLE_CODES } from "@mywfm/shared";

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  displayName: z.string().trim().min(1).max(200),
  roleCodes: z.array(z.enum(ROLE_CODES)).min(1, "Assign at least one role."),
});

export const setRolesSchema = z.object({
  roleCodes: z.array(z.enum(ROLE_CODES)).min(1, "Assign at least one role."),
});

export const setActiveSchema = z.object({
  isActive: z.boolean(),
});
