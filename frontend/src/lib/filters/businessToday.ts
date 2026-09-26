/**
 * PHASE 1 PLACEHOLDER for "what is today's WFM business date". The real
 * answer is config-driven (business_day.timezone, and eventually shift-aware
 * boundaries - see shared/src/businessDate.ts and Phase 5's Business Day
 * Engine). Until that's exposed over the API, this mirrors the seeded default
 * timezone (Asia/Kolkata - see database/seed-data/0002_default_configuration.sql)
 * so the Global Filter Bar's "Yesterday" default doesn't drift with whatever
 * timezone the browser happens to be in.
 */
const PLACEHOLDER_TIMEZONE = "Asia/Kolkata";

export function getPlaceholderBusinessToday(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the ISO date shape resolveDateRangePreset expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone: PLACEHOLDER_TIMEZONE }).format(new Date());
}
