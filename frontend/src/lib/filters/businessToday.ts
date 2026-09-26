/**
 * Synchronous fallback for "what is today's WFM business date", used only for the very first
 * render before FilterProvider's effect gets a real answer from `GET /api/business-day/today`
 * (config-driven - business_day.timezone/business_day.start_time - via
 * shared/src/businessDate.ts's resolveGlobalBusinessDate). This mirrors the seeded default
 * timezone (Asia/Kolkata - see database/seed-data/0002_default_configuration.sql) so that
 * first render doesn't drift with whatever timezone the browser happens to be in; it ignores
 * business_day.start_time (assumes plain midnight rollover) since a config change to that
 * value only matters for the brief window before the real endpoint responds.
 */
const PLACEHOLDER_TIMEZONE = "Asia/Kolkata";

export function getPlaceholderBusinessToday(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the ISO date shape resolveDateRangePreset expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone: PLACEHOLDER_TIMEZONE }).format(new Date());
}
