/**
 * Platform-wide role codes.
 *
 * These map 1:1 to rows in database/migrations/0001_security_foundation.sql (dbo.Roles).
 * The TypeScript union is the compile-time mirror of that seed data; the seed data remains
 * the runtime source of truth so an ADMIN can rename/extend roles without a code deploy.
 */
export const ROLE_CODES = ["REQUESTOR", "LEADER", "HOD", "WFM", "ADMIN"] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  REQUESTOR: "User / Requestor",
  LEADER: "Leader / TL",
  HOD: "Head of Department",
  WFM: "WFM",
  ADMIN: "Administrator",
};

/**
 * Coarse seniority ordering used only for UI affordances (e.g. "can this role escalate to
 * that role's queue"). Never use this for authorization decisions - permission checks must
 * always go through explicit permission codes, enforced server-side.
 */
export const ROLE_RANK: Record<RoleCode, number> = {
  REQUESTOR: 0,
  LEADER: 1,
  HOD: 2,
  WFM: 3,
  ADMIN: 4,
};
