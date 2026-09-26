import { env } from "../config/env.js";
import { getPool, sql, closePool } from "../db/pool.js";
import { hashPassword } from "../modules/auth/password.js";
import { logger } from "../logger/logger.js";

const DEMO_EMAIL = "admin@example.com";
const DEMO_PASSWORD = "DemoPassword123!";

/**
 * DEMO DATA - local development convenience only. Creates one obviously-fake
 * ADMIN login so a fresh clone can sign in immediately without running the
 * interactive create-admin script. Refuses to run against production.
 */
async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("seedDev must not run with NODE_ENV=production. Use `npm run create-admin` instead.");
  }

  const pool = await getPool();
  const existing = await pool
    .request()
    .input("Email", sql.NVarChar(256), DEMO_EMAIL)
    .query<{ UserId: string }>("SELECT UserId FROM security.[User] WHERE Email = @Email");

  if (existing.recordset.length > 0) {
    logger.info({ email: DEMO_EMAIL }, "DEMO DATA admin already exists, skipping");
    return;
  }

  const roleResult = await pool
    .request()
    .query<{ RoleId: number }>("SELECT RoleId FROM security.Role WHERE RoleCode = 'ADMIN'");
  const adminRoleId = roleResult.recordset[0]?.RoleId;
  if (!adminRoleId) {
    throw new Error('The ADMIN role does not exist yet. Run "npm run db:seed --workspace=backend" first.');
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const insertResult = await pool
    .request()
    .input("Email", sql.NVarChar(256), DEMO_EMAIL)
    .input("PasswordHash", sql.NVarChar(200), passwordHash)
    .input("DisplayName", sql.NVarChar(200), "Demo Admin")
    .query<{ UserId: string }>(`
      INSERT INTO security.[User] (Email, PasswordHash, DisplayName)
      OUTPUT INSERTED.UserId
      VALUES (@Email, @PasswordHash, @DisplayName)
    `);
  const userId = insertResult.recordset[0]!.UserId;

  await pool
    .request()
    .input("UserId", sql.UniqueIdentifier, userId)
    .input("RoleId", sql.Int, adminRoleId)
    .query("INSERT INTO security.UserRole (UserId, RoleId) VALUES (@UserId, @RoleId)");

  logger.info(
    { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    "DEMO DATA admin account created - local development only, never use in production",
  );
}

main()
  .catch((err) => {
    logger.critical({ err }, "seedDev failed");
    process.exitCode = 1;
  })
  .finally(() => closePool());
