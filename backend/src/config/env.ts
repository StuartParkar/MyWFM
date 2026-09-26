import { z } from "zod";

/**
 * Process-environment validation. Fails fast at boot with a readable message
 * instead of surfacing a confusing error deep inside the DB driver or JWT
 * library later. No secret ever has a baked-in fallback - if it's missing,
 * boot fails.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1),

  SQL_SERVER_HOST: z.string().min(1),
  SQL_SERVER_PORT: z.coerce.number().int().positive().default(1433),
  SQL_SERVER_DATABASE: z.string().min(1),
  SQL_SERVER_USER: z.string().min(1),
  SQL_SERVER_PASSWORD: z.string().min(1),
  SQL_SERVER_ENCRYPT: z.coerce.boolean().default(true),
  SQL_SERVER_TRUST_SERVER_CERTIFICATE: z.coerce.boolean().default(false),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_REFRESH_PEPPER: z.string().min(16, "JWT_REFRESH_PEPPER must be at least 16 characters"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
