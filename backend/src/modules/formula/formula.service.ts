import * as repo from "./formula.repository.js";
import * as importRepo from "../imports/import.repository.js";

export interface CalculationLineage extends repo.CalculationLedgerDetail {
  /** Resolved from sourceReference's real IMPORT-* code(s) - empty when this formula wasn't
   * computed from a specific import run (Shrinkage/Staffing/Forecast/Attrition Rate today all
   * compute from live/manual data, so sourceReference is null and this is honestly empty - see
   * documentation/formulas.md and documentation/lineage-and-reprocessing.md). */
  sourceImportRuns: importRepo.ImportRunSummary[];
}

/** Parses the real IMPORT-NNNNNNNN codes callMetrics.service.ts's buildImportSourceReference wrote - ignores a trailing ",+N more" marker, never treats it as a code. */
export function parseImportRunIds(sourceReference: string): number[] {
  const matches = sourceReference.matchAll(/IMPORT-(\d{8})/g);
  return [...matches].map((m) => Number(m[1]));
}

export async function getCalculationLineage(calculationLedgerId: number): Promise<CalculationLineage | null> {
  const detail = await repo.getCalculationById(calculationLedgerId);
  if (!detail) return null;
  const sourceImportRuns = detail.sourceReference ? await importRepo.getImportRunSummaries(parseImportRunIds(detail.sourceReference)) : [];
  return { ...detail, sourceImportRuns };
}
