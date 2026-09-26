/**
 * Permission codes enforced by the backend RBAC middleware (backend/src/middleware/rbac.ts).
 *
 * This list only covers what Phase 1 (security/config/audit/system foundation) actually
 * enforces. Later phases append their own module.action codes here as those modules are
 * built (roster.*, import.*, formula.*, forecast.*, scenario.*, ...). Do not pre-declare
 * permissions for modules that do not exist yet.
 *
 * The authoritative row-level grants live in dbo.Permissions / dbo.RolePermissions so they
 * can be adjusted by an ADMIN at runtime; this union is the compile-time mirror used by
 * route handlers so a typo in a permission code fails to compile instead of failing silently
 * at 3am.
 */
export const PERMISSION_CODES = [
  // User & role administration
  "user.view",
  "user.manage",
  "role.manage",

  // Configuration Center
  "config.view",
  "config.manage",

  // Audit
  "audit.view",

  // System health / background jobs
  "system.health.view",
  "job.view",
  "job.manage",

  // Master data (Phase 2)
  "masterdata.view",
  "masterdata.manage",

  // Import Center / Data Quality (Phase 3)
  "import.view",
  "import.execute",
  "dataquality.view",

  // Roster workflow (Phase 4)
  "roster.view",
  "roster.submit",
  "roster.review.leader",
  "roster.review.hod",
  "roster.review.wfm",
  "roster.change",

  // Attendance & Business Day Engine (Phase 5)
  "attendance.view",
  "attendance.manage",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
