/**
 * Date range presets for the Global Filter Bar (build spec section 8).
 */
export const DATE_RANGE_PRESETS = [
  "YESTERDAY",
  "TODAY",
  "LAST_7_DAYS",
  "LAST_14_DAYS",
  "LAST_30_DAYS",
  "THIS_WEEK",
  "LAST_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "CUSTOM",
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

export interface DateRange {
  preset: DateRangePreset;
  /** Inclusive, ISO business date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive, ISO business date (YYYY-MM-DD). */
  endDate: string;
}

/**
 * Global Filter Bar state, shared across all applicable screens (build spec section 8).
 *
 * `process`, `agentSenior`, `tl` and `hod` cascade (HOD -> TL -> Agent/Senior -> Individual
 * Agent); `designation` is intentionally independent of that cascade. The real cascading
 * option lists come from the Phase 2 master-data/organization API once it exists - Phase 1
 * only defines the shape of the state and its persistence, not the data behind it.
 */
export interface GlobalFilterState {
  dateRange: DateRange;
  process: string | "ALL";
  hod: string | "ALL";
  tl: string | "ALL";
  agentSenior: string | "ALL";
  agentId: string | "ALL";
  designation: string;
}

export const DEFAULT_DESIGNATION = "Agent";

export function createDefaultFilterState(todayBusinessDate: string): GlobalFilterState {
  return {
    dateRange: {
      preset: "YESTERDAY",
      startDate: todayBusinessDate,
      endDate: todayBusinessDate,
    },
    process: "ALL",
    hod: "ALL",
    tl: "ALL",
    agentSenior: "ALL",
    agentId: "ALL",
    designation: DEFAULT_DESIGNATION,
  };
}
