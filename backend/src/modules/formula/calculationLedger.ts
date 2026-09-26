import { getPool, sql } from "../../db/pool.js";
import { logger } from "../../logger/logger.js";

export interface CalculationEntry {
  formulaCode: string;
  formulaVersion: number;
  entityType: string;
  entityId: string;
  businessDate: string;
  computedValue: number;
  inputsSnapshot?: unknown;
  /** The build spec's "Source Data Version" (e.g. an IMPORT-* code) - only set when the
   * inputs actually came from an import run; omitted for manually entered sources. */
  sourceReference?: string | null;
  computedByUserId?: string | null;
}

/**
 * Writes to formula.CalculationLedger (build spec section 6's architecture: every KPI a
 * formula produces is persisted here, with its formula version and the inputs it used, not
 * just handed back in an API response and forgotten - section 23's Data Lineage reads this
 * table). Same "never throw into the caller" discipline as audit.service.ts's recordAudit -
 * a ledger-write failure must not stop the caller getting the value it just computed.
 */
export async function recordCalculation(entry: CalculationEntry): Promise<void> {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("FormulaCode", sql.VarChar(50), entry.formulaCode)
      .input("FormulaVersion", sql.Int, entry.formulaVersion)
      .input("EntityType", sql.VarChar(50), entry.entityType)
      .input("EntityId", sql.VarChar(100), entry.entityId)
      .input("BusinessDate", sql.Date, entry.businessDate)
      .input("ComputedValue", sql.Decimal(18, 4), entry.computedValue)
      .input("InputsSnapshot", sql.NVarChar(sql.MAX), entry.inputsSnapshot !== undefined ? JSON.stringify(entry.inputsSnapshot) : null)
      .input("SourceReference", sql.NVarChar(100), entry.sourceReference ?? null)
      .input("ComputedByUserId", sql.UniqueIdentifier, entry.computedByUserId ?? null)
      .query(`
        INSERT INTO [formula].CalculationLedger (FormulaCode, FormulaVersion, EntityType, EntityId, BusinessDate, ComputedValue, InputsSnapshot, SourceReference, ComputedByUserId)
        VALUES (@FormulaCode, @FormulaVersion, @EntityType, @EntityId, @BusinessDate, @ComputedValue, @InputsSnapshot, @SourceReference, @ComputedByUserId)
      `);
  } catch (err) {
    logger.critical({ err, entry }, "Failed to write calculation ledger entry");
  }
}
