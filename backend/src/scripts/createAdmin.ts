import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getPool, sql, closePool } from "../db/pool.js";
import { loadAppConfig } from "../config/appConfig.js";
import { hashPassword, validatePasswordPolicy } from "../modules/auth/password.js";
import { recordAudit } from "../modules/audit/audit.service.js";
import { logger } from "../logger/logger.js";

/**
 * Production bootstrap for the very first ADMIN account. Deliberately a
 * script, not a seed .sql file: hashing belongs in the app layer, using the
 * exact same hashPassword() the login flow verifies against (see
 * database/seed-data/README.md for why).
 *
 * Usage:
 *   npm run create-admin --workspace=backend -- --email you@company.com --password 'Str0ngPass!'
 * or answer the interactive prompts if either flag is omitted.
 */
function parseArg(name: string): string | undefined {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  if (!hidden) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }
  // Minimal masking: Node has no built-in hidden-input prompt without a TTY dependency.
  stdout.write(`${question}(input will be visible) `);
  const answer = await rl.question("");
  rl.close();
  return answer.trim();
}

async function main(): Promise<void> {
  await loadAppConfig();

  const email = (parseArg("email") ?? process.env.ADMIN_EMAIL ?? (await prompt("Admin email: "))).trim().toLowerCase();
  const password = parseArg("password") ?? process.env.ADMIN_PASSWORD ?? (await prompt("Admin password: ", true));

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    throw new Error(`Password does not meet policy:\n  - ${policy.errors.join("\n  - ")}`);
  }

  const pool = await getPool();
  const existing = await pool
    .request()
    .input("Email", sql.NVarChar(256), email)
    .query<{ UserId: string }>("SELECT UserId FROM security.[User] WHERE Email = @Email");

  if (existing.recordset.length > 0) {
    throw new Error(`A user with email "${email}" already exists.`);
  }

  const roleResult = await pool
    .request()
    .query<{ RoleId: number }>("SELECT RoleId FROM security.Role WHERE RoleCode = 'ADMIN'");
  const adminRoleId = roleResult.recordset[0]?.RoleId;
  if (!adminRoleId) {
    throw new Error('The ADMIN role does not exist yet. Run "npm run db:seed --workspace=backend" first.');
  }

  const passwordHash = await hashPassword(password);
  const insertResult = await pool
    .request()
    .input("Email", sql.NVarChar(256), email)
    .input("PasswordHash", sql.NVarChar(200), passwordHash)
    .input("DisplayName", sql.NVarChar(200), email.split("@")[0])
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

  await recordAudit({
    entityType: "User",
    entityId: userId,
    action: "ADMIN_BOOTSTRAP",
    reason: "Initial ADMIN account created via create-admin script",
  });

  logger.info({ email, userId }, "ADMIN account created successfully");
}

main()
  .catch((err) => {
    logger.critical({ err }, "create-admin failed");
    process.exitCode = 1;
  })
  .finally(() => closePool());
