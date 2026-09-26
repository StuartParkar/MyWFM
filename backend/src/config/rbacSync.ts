import { PERMISSION_CODES, ROLE_CODES } from "@mywfm/shared";
import { getPool } from "../db/pool.js";
import { logger } from "../logger/logger.js";

/**
 * Startup-only consistency check between the compile-time RoleCode/PermissionCode
 * unions (shared/src/constants) and the actual rows in security.Role /
 * security.Permission. A mismatch is logged as a WARNING, never a hard
 * failure: an ADMIN is allowed to add DB-only roles/permissions ahead of the
 * corresponding code change landing, and a code deploy is allowed to land
 * ahead of someone running the seed script. Either way, silently drifting is
 * worse than a loud log line, which is all this does.
 */
export async function checkRbacSync(): Promise<void> {
  try {
    const pool = await getPool();
    const [roleResult, permissionResult] = await Promise.all([
      pool.request().query<{ RoleCode: string }>("SELECT RoleCode FROM security.Role"),
      pool.request().query<{ PermissionCode: string }>("SELECT PermissionCode FROM security.Permission"),
    ]);

    const dbRoles = new Set(roleResult.recordset.map((r) => r.RoleCode));
    const dbPermissions = new Set(permissionResult.recordset.map((p) => p.PermissionCode));

    const missingRolesInDb = ROLE_CODES.filter((code) => !dbRoles.has(code));
    const missingPermissionsInDb = PERMISSION_CODES.filter((code) => !dbPermissions.has(code));

    if (missingRolesInDb.length > 0) {
      logger.warn({ missingRolesInDb }, "Roles defined in code are missing from security.Role - run npm run db:seed");
    }
    if (missingPermissionsInDb.length > 0) {
      logger.warn(
        { missingPermissionsInDb },
        "Permissions defined in code are missing from security.Permission - run npm run db:seed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Could not verify RBAC code/database sync (database unavailable)");
  }
}
