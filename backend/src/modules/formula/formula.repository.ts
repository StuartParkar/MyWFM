import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export interface FormulaDefinitionRow {
  formulaCode: string;
  version: number;
  name: string;
  description: string;
  category: string;
  effectiveFrom: string;
}

export async function listActiveFormulas(): Promise<FormulaDefinitionRow[]> {
  const pool = await getPool();
  const result = await pool.request().query<{
    FormulaCode: string;
    Version: number;
    Name: string;
    Description: string;
    Category: string;
    EffectiveFrom: string;
  }>(`
    SELECT FormulaCode, Version, Name, Description, Category, CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom
    FROM [formula].FormulaDefinition
    WHERE IsActive = 1
    ORDER BY Category, Name
  `);
  return result.recordset.map((r) => ({
    formulaCode: r.FormulaCode,
    version: r.Version,
    name: r.Name,
    description: r.Description,
    category: r.Category,
    effectiveFrom: r.EffectiveFrom,
  }));
}

export interface CalculationLedgerRow {
  calculationLedgerId: number;
  /** Display code in the same "PREFIX-00000001" style as IMPORT-* codes. */
  calculationCode: string;
  formulaCode: string;
  formulaVersion: number;
  /** "SHRINKAGE_PCT-V1"-style label, matching the build spec's own STAFFING-V1/SHRINKAGE-V1 naming, for display only - FormulaCode and Version stay separate, normalized columns underneath. */
  formulaVersionLabel: string;
  entityType: string;
  entityId: string;
  businessDate: string;
  computedValue: number;
  sourceReference: string | null;
  computedAt: string;
}

function toCalculationCode(id: number): string {
  return `CALC-${String(id).padStart(8, "0")}`;
}

export async function listCalculationHistory(params: {
  formulaCode?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<CalculationLedgerRow>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const result = await pool
    .request()
    .input("FormulaCode", sql.VarChar(50), params.formulaCode ?? null)
    .input("EntityType", sql.VarChar(50), params.entityType ?? null)
    .input("EntityId", sql.VarChar(100), params.entityId ?? null)
    .input("From", sql.Date, params.from ?? null)
    .input("To", sql.Date, params.to ?? null)
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize)
    .query<{
      CalculationLedgerId: number;
      FormulaCode: string;
      FormulaVersion: number;
      EntityType: string;
      EntityId: string;
      BusinessDate: string;
      ComputedValue: number;
      SourceReference: string | null;
      ComputedAt: Date;
      TotalCount: number;
    }>(`
      SELECT CalculationLedgerId, FormulaCode, FormulaVersion, EntityType, EntityId,
             CONVERT(VARCHAR(10), BusinessDate, 23) AS BusinessDate, ComputedValue, SourceReference, ComputedAt,
             COUNT(*) OVER() AS TotalCount
      FROM [formula].CalculationLedger
      WHERE (@FormulaCode IS NULL OR FormulaCode = @FormulaCode)
        AND (@EntityType IS NULL OR EntityType = @EntityType)
        AND (@EntityId IS NULL OR EntityId = @EntityId)
        AND (@From IS NULL OR BusinessDate >= @From)
        AND (@To IS NULL OR BusinessDate <= @To)
      ORDER BY ComputedAt DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      calculationLedgerId: r.CalculationLedgerId,
      calculationCode: toCalculationCode(r.CalculationLedgerId),
      formulaCode: r.FormulaCode,
      formulaVersion: r.FormulaVersion,
      formulaVersionLabel: `${r.FormulaCode}-V${r.FormulaVersion}`,
      entityType: r.EntityType,
      entityId: r.EntityId,
      businessDate: r.BusinessDate,
      computedValue: r.ComputedValue,
      sourceReference: r.SourceReference,
      computedAt: r.ComputedAt.toISOString(),
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}
