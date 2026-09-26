import { getPool } from "../db/pool.js";
import { logger } from "../logger/logger.js";

interface ConfigRow {
  SettingKey: string;
  SettingValue: string;
  ValueType: "STRING" | "NUMBER" | "BOOLEAN" | "JSON";
}

let cache = new Map<string, ConfigRow>();
let loaded = false;

/**
 * Loads every active row from config.ConfigurationSetting into memory. Safe to
 * call again later (e.g. after a Configuration Center change) to pick up new
 * values without a restart. If the database is unreachable, logs a warning and
 * leaves the previous cache (or an empty one at boot) in place - callers fall
 * back to the default they pass to getConfig*, so a DB outage degrades
 * gracefully instead of crashing config lookups everywhere.
 */
export async function loadAppConfig(): Promise<void> {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query<ConfigRow>("SELECT SettingKey, SettingValue, ValueType FROM config.ConfigurationSetting WHERE IsActive = 1");
    cache = new Map(result.recordset.map((row) => [row.SettingKey, row]));
    loaded = true;
    logger.info({ count: cache.size }, "Loaded configuration settings");
  } catch (err) {
    logger.warn({ err }, "Could not load configuration settings from the database; falling back to defaults where provided");
  }
}

export function isAppConfigLoaded(): boolean {
  return loaded;
}

function getRaw(key: string): ConfigRow | undefined {
  return cache.get(key);
}

export function getConfigString(key: string, fallback: string): string {
  const row = getRaw(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.SettingValue) as string;
  } catch {
    return fallback;
  }
}

export function getConfigNumber(key: string, fallback: number): number {
  const row = getRaw(key);
  if (!row) return fallback;
  const parsed = Number(row.SettingValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfigBoolean(key: string, fallback: boolean): boolean {
  const row = getRaw(key);
  if (!row) return fallback;
  return row.SettingValue.trim().toLowerCase() === "true";
}
