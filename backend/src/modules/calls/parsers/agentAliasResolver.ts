import { getPool } from "../../../db/pool.js";

export interface AliasIndexEntry {
  employeeId: string;
  fullName: string;
}

export type AliasIndex = Map<string, AliasIndexEntry>;

export async function buildAliasIndex(): Promise<AliasIndex> {
  const pool = await getPool();
  const result = await pool.request().query<{ EmployeeId: string; FullName: string; AliasName: string | null }>(`
    SELECT EmployeeId, FullName, AliasName FROM [master].Employee WHERE AliasName IS NOT NULL AND IsActive = 1
  `);
  const index: AliasIndex = new Map();
  for (const row of result.recordset) {
    if (row.AliasName) index.set(row.AliasName.trim().toLowerCase(), { employeeId: row.EmployeeId, fullName: row.FullName });
  }
  return index;
}

/**
 * Phone systems append their own team-code suffix to an agent's real alias - observed directly
 * across all three real files (Vonage's "Rocky TOT", "GarryTHD", RingCentral's "Alvin BCA") -
 * none of which is part of the alias itself (validated against imports/samples/master-data:
 * "Rocky" is Ritesh Kumar Thakur's real AliasName, with no suffix stored). Not an exhaustive
 * or authoritative list - just every suffix actually observed; an unrecognized one simply
 * falls through to the unresolved case rather than guessing.
 */
const KNOWN_SUFFIXES = ["THD", "TOT", "STF", "BCA", "ICX"];

/**
 * Resolves a raw agent name/label from a phone system into a known employee, trying (in
 * order): the raw string as-is, its first token split on whitespace or a dot (handles
 * "Rocky TOT" and "Alan.Young"), then the raw string with a known team-code suffix stripped
 * (handles the no-space-separator case, "GarryTHD"). Returns null - never a guess - when none
 * resolve, so the caller can raise UNRESOLVED_CALL_PARTICIPANT rather than silently
 * misattributing the call.
 */
export function resolveAgentAlias(raw: string, index: AliasIndex): AliasIndexEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const exact = index.get(trimmed.toLowerCase());
  if (exact) return exact;

  const firstToken = trimmed.split(/[\s.]+/)[0];
  if (firstToken && firstToken !== trimmed) {
    const byFirstToken = index.get(firstToken.toLowerCase());
    if (byFirstToken) return byFirstToken;
  }

  const upper = trimmed.toUpperCase();
  for (const suffix of KNOWN_SUFFIXES) {
    if (upper.endsWith(suffix) && upper.length > suffix.length) {
      const base = trimmed.slice(0, trimmed.length - suffix.length).trim();
      const bySuffix = index.get(base.toLowerCase());
      if (bySuffix) return bySuffix;
    }
  }

  return null;
}
