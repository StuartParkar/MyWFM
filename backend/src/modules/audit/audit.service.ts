import { getPool, sql } from "../../db/pool.js";
import { logger } from "../../logger/logger.js";

export interface AuditEntry {
  entityType: string;
  entityId?: string;
  action: string;
  performedByUserId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  referenceId?: string;
  ipAddress?: string | null;
  correlationId?: string;
}

/**
 * Writes to audit.AuditLog (build spec section 44: every important change is
 * auditable - who/what/when/where/before/after/reason/reference). Called
 * explicitly by services rather than by a DB trigger, because it needs
 * request-level context a trigger cannot see.
 *
 * Never throws into the caller's control flow: an audit-write failure must not
 * block the business operation it's describing, but it must not vanish
 * silently either, so it's logged at CRITICAL - a broken audit trail is a
 * production incident, just not one that should take the login flow down
 * with it.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("EntityType", sql.VarChar(100), entry.entityType)
      .input("EntityId", sql.VarChar(100), entry.entityId ?? null)
      .input("Action", sql.VarChar(60), entry.action)
      .input("PerformedByUserId", sql.UniqueIdentifier, entry.performedByUserId ?? null)
      .input("BeforeValue", sql.NVarChar(sql.MAX), entry.before !== undefined ? JSON.stringify(entry.before) : null)
      .input("AfterValue", sql.NVarChar(sql.MAX), entry.after !== undefined ? JSON.stringify(entry.after) : null)
      .input("Reason", sql.NVarChar(500), entry.reason ?? null)
      .input("ReferenceId", sql.VarChar(100), entry.referenceId ?? null)
      .input("IpAddress", sql.VarChar(64), entry.ipAddress ?? null)
      .input("CorrelationId", sql.UniqueIdentifier, entry.correlationId ?? null)
      .query(`
        INSERT INTO audit.AuditLog
          (EntityType, EntityId, Action, PerformedByUserId, BeforeValue, AfterValue, Reason, ReferenceId, IpAddress, CorrelationId)
        VALUES
          (@EntityType, @EntityId, @Action, @PerformedByUserId, @BeforeValue, @AfterValue, @Reason, @ReferenceId, @IpAddress, @CorrelationId)
      `);
  } catch (err) {
    logger.critical({ err, entry }, "Failed to write audit log entry");
  }
}

export interface AuditListItem {
  auditId: number;
  entityType: string;
  entityId: string | null;
  action: string;
  performedByUserId: string | null;
  performedAt: Date;
  reason: string | null;
  referenceId: string | null;
}

export async function listRecentAudit(limit: number): Promise<AuditListItem[]> {
  const pool = await getPool();
  const result = await pool.request().input("Limit", sql.Int, limit).query<{
    AuditId: number;
    EntityType: string;
    EntityId: string | null;
    Action: string;
    PerformedByUserId: string | null;
    PerformedAt: Date;
    Reason: string | null;
    ReferenceId: string | null;
  }>(`
    SELECT TOP (@Limit) AuditId, EntityType, EntityId, Action, PerformedByUserId, PerformedAt, Reason, ReferenceId
    FROM audit.AuditLog
    ORDER BY PerformedAt DESC
  `);

  return result.recordset.map((row) => ({
    auditId: row.AuditId,
    entityType: row.EntityType,
    entityId: row.EntityId,
    action: row.Action,
    performedByUserId: row.PerformedByUserId,
    performedAt: row.PerformedAt,
    reason: row.Reason,
    referenceId: row.ReferenceId,
  }));
}
