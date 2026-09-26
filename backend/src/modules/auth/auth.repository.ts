import type { PermissionCode, RoleCode } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";
import { getConfigNumber } from "../../config/appConfig.js";

export interface UserAuthProfile {
  userId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  roles: RoleCode[];
  permissions: PermissionCode[];
}

interface UserRow {
  UserId: string;
  Email: string;
  PasswordHash: string;
  DisplayName: string;
  IsActive: boolean;
  FailedLoginAttempts: number;
  LockedUntil: Date | null;
}

export async function getUserAuthProfile(
  lookup: { email: string } | { userId: string },
): Promise<UserAuthProfile | null> {
  const pool = await getPool();
  const request = pool.request();
  if ("email" in lookup) {
    request.input("Email", sql.NVarChar(256), lookup.email);
  } else {
    request.input("UserId", sql.UniqueIdentifier, lookup.userId);
  }

  const result = await request.execute("security.usp_GetUserAuthProfile");
  const [userRows, roleRows, permissionRows] = result.recordsets as unknown as [
    UserRow[],
    { RoleCode: RoleCode }[],
    { PermissionCode: PermissionCode }[],
  ];

  const userRow = userRows[0];
  if (!userRow) return null;

  return {
    userId: userRow.UserId,
    email: userRow.Email,
    passwordHash: userRow.PasswordHash,
    displayName: userRow.DisplayName,
    isActive: userRow.IsActive,
    failedLoginAttempts: userRow.FailedLoginAttempts,
    lockedUntil: userRow.LockedUntil,
    roles: roleRows.map((r) => r.RoleCode),
    permissions: permissionRows.map((p) => p.PermissionCode),
  };
}

export async function recordFailedLogin(userId: string): Promise<void> {
  const maxAttempts = getConfigNumber("security.max_failed_login_attempts", 5);
  const lockoutMinutes = getConfigNumber("security.account_lockout_minutes", 15);
  const pool = await getPool();

  await pool
    .request()
    .input("UserId", sql.UniqueIdentifier, userId)
    .input("MaxAttempts", sql.Int, maxAttempts)
    .input("LockoutMinutes", sql.Int, lockoutMinutes)
    .query(`
      UPDATE security.[User]
      SET
        FailedLoginAttempts = FailedLoginAttempts + 1,
        LockedUntil = CASE
          WHEN FailedLoginAttempts + 1 >= @MaxAttempts THEN DATEADD(MINUTE, @LockoutMinutes, SYSUTCDATETIME())
          ELSE LockedUntil
        END,
        ModifiedAt = SYSUTCDATETIME()
      WHERE UserId = @UserId
    `);
}

export async function resetFailedLoginsAndTouchLogin(userId: string): Promise<void> {
  const pool = await getPool();
  await pool.request().input("UserId", sql.UniqueIdentifier, userId).query(`
      UPDATE security.[User]
      SET FailedLoginAttempts = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME(), ModifiedAt = SYSUTCDATETIME()
      WHERE UserId = @UserId
    `);
}

export interface InsertRefreshTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdByIp: string | null;
  userAgent: string | null;
}

export async function insertRefreshToken(input: InsertRefreshTokenInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("UserId", sql.UniqueIdentifier, input.userId)
    .input("TokenHash", sql.Char(64), input.tokenHash)
    .input("ExpiresAt", sql.DateTime2, input.expiresAt)
    .input("CreatedByIp", sql.VarChar(64), input.createdByIp)
    .input("UserAgent", sql.NVarChar(400), input.userAgent)
    .query(`
      INSERT INTO security.RefreshToken (UserId, TokenHash, ExpiresAt, CreatedByIp, UserAgent)
      VALUES (@UserId, @TokenHash, @ExpiresAt, @CreatedByIp, @UserAgent)
    `);
}

export interface ActiveRefreshToken {
  refreshTokenId: string;
  userId: string;
}

export async function findActiveRefreshTokenByHash(tokenHash: string): Promise<ActiveRefreshToken | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("TokenHash", sql.Char(64), tokenHash)
    .query<{ RefreshTokenId: string; UserId: string }>(`
      SELECT RefreshTokenId, UserId
      FROM security.RefreshToken
      WHERE TokenHash = @TokenHash
        AND RevokedAt IS NULL
        AND ExpiresAt > SYSUTCDATETIME()
    `);
  const row = result.recordset[0];
  return row ? { refreshTokenId: row.RefreshTokenId, userId: row.UserId } : null;
}

export async function revokeRefreshToken(refreshTokenId: string, replacedByTokenId?: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("RefreshTokenId", sql.UniqueIdentifier, refreshTokenId)
    .input("ReplacedByTokenId", sql.UniqueIdentifier, replacedByTokenId ?? null)
    .query(`
      UPDATE security.RefreshToken
      SET RevokedAt = SYSUTCDATETIME(), ReplacedByTokenId = @ReplacedByTokenId
      WHERE RefreshTokenId = @RefreshTokenId
    `);
}
