import type { PaginatedResult, RoleCode } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export interface UserListItem {
  userId: string;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: RoleCode[];
  lastLoginAt: string | null;
}

export async function listUsers(page: number, pageSize: number, search?: string): Promise<PaginatedResult<UserListItem>> {
  const pool = await getPool();
  const offset = (page - 1) * pageSize;
  const request = pool.request().input("Offset", sql.Int, offset).input("PageSize", sql.Int, pageSize);
  if (search) request.input("Search", sql.NVarChar(200), `%${search}%`);

  const result = await request.query<{
    UserId: string;
    Email: string;
    DisplayName: string;
    IsActive: boolean;
    LastLoginAt: Date | null;
    Roles: string | null;
    TotalCount: number;
  }>(`
    SELECT
      u.UserId, u.Email, u.DisplayName, u.IsActive, u.LastLoginAt,
      (SELECT STRING_AGG(r.RoleCode, ',') FROM security.UserRole ur JOIN security.Role r ON r.RoleId = ur.RoleId WHERE ur.UserId = u.UserId) AS Roles,
      COUNT(*) OVER() AS TotalCount
    FROM security.[User] u
    WHERE (@Search IS NULL OR u.Email LIKE @Search OR u.DisplayName LIKE @Search)
    ORDER BY u.DisplayName
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);

  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      userId: r.UserId,
      email: r.Email,
      displayName: r.DisplayName,
      isActive: r.IsActive,
      roles: (r.Roles?.split(",").filter(Boolean) ?? []) as RoleCode[],
      lastLoginAt: r.LastLoginAt ? r.LastLoginAt.toISOString() : null,
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function findUserByEmail(email: string): Promise<{ userId: string } | null> {
  const pool = await getPool();
  const result = await pool.request().input("Email", sql.NVarChar(256), email).query<{ UserId: string }>(`
    SELECT UserId FROM security.[User] WHERE Email = @Email
  `);
  return result.recordset[0] ? { userId: result.recordset[0].UserId } : null;
}

export async function createUser(input: { email: string; passwordHash: string; displayName: string }): Promise<string> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Email", sql.NVarChar(256), input.email)
    .input("PasswordHash", sql.NVarChar(200), input.passwordHash)
    .input("DisplayName", sql.NVarChar(200), input.displayName)
    .query<{ UserId: string }>(`
      INSERT INTO security.[User] (Email, PasswordHash, DisplayName) OUTPUT INSERTED.UserId VALUES (@Email, @PasswordHash, @DisplayName)
    `);
  return result.recordset[0]!.UserId;
}

export async function setUserRoles(userId: string, roleCodes: RoleCode[]): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input("UserId", sql.UniqueIdentifier, userId).query(`DELETE FROM security.UserRole WHERE UserId = @UserId`);
    for (const roleCode of roleCodes) {
      await new sql.Request(transaction)
        .input("UserId", sql.UniqueIdentifier, userId)
        .input("RoleCode", sql.VarChar(20), roleCode)
        .query(`
          INSERT INTO security.UserRole (UserId, RoleId)
          SELECT @UserId, RoleId FROM security.Role WHERE RoleCode = @RoleCode
        `);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("UserId", sql.UniqueIdentifier, userId)
    .input("IsActive", sql.Bit, isActive)
    .query(`UPDATE security.[User] SET IsActive = @IsActive, ModifiedAt = SYSUTCDATETIME() WHERE UserId = @UserId`);
}

export async function listRoles(): Promise<{ roleCode: RoleCode; roleName: string }[]> {
  const pool = await getPool();
  const result = await pool.request().query<{ RoleCode: RoleCode; RoleName: string }>(`
    SELECT RoleCode, RoleName FROM security.Role WHERE IsActive = 1 ORDER BY RoleName
  `);
  return result.recordset.map((r) => ({ roleCode: r.RoleCode, roleName: r.RoleName }));
}
