import { addDays } from "@mywfm/shared";
import { getConfigNumber } from "../../config/appConfig.js";
import { recordCalculation } from "../formula/calculationLedger.js";
import { listHolidays } from "../masterdata/masterdata.repository.js";
import * as repo from "./forecast.repository.js";

export interface ForecastRow {
  businessDate: string;
  queueId: number;
  queueName: string | null;
  baseForecast: number | null;
  trendFactor: number | null;
  seasonalityFactor: number | null;
  holidayFactor: number;
  forecastedCalls: number | null;
  actualOfferedCalls: number | null;
  historyDaysUsed: number;
}

export interface ForecastAccuracySummary {
  queueId: number | null;
  daysEvaluated: number;
  mae: number | null;
  mape: number | null;
  bias: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function avg(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

interface QueueHistory {
  queueName: string | null;
  byDate: Map<string, number>;
}

async function buildHistoryByQueue(queueId: number | undefined, from: string, to: string): Promise<Map<number, QueueHistory>> {
  const rows = await repo.listDailyCallVolume({ from, to, queueId });
  const byQueue = new Map<number, QueueHistory>();
  for (const r of rows) {
    let q = byQueue.get(r.queueId);
    if (!q) {
      q = { queueName: r.queueName, byDate: new Map() };
      byQueue.set(r.queueId, q);
    }
    q.byDate.set(r.businessDate, r.offeredCalls);
  }
  // A specific queue with zero history in range still gets one honest "insufficient
  // history" row per requested date, rather than silently returning nothing - section 79
  // rules out an empty response looking indistinguishable from "wrong queue id".
  if (queueId !== undefined && !byQueue.has(queueId)) byQueue.set(queueId, { queueName: null, byDate: new Map() });
  return byQueue;
}

/**
 * Base Forecast x Trend Factor x Seasonality Factor x Holiday Factor (build spec section 21).
 * Every factor is a plain, auditable average/ratio over real historical Offered Calls strictly
 * before targetDate - never the target date's own (future, or not-yet-known) volume. Returns
 * nulls rather than a fabricated number when there simply isn't enough history yet (a new
 * queue, or a queue with only a handful of real sample dates imported so far).
 */
function computeForecastForDate(
  targetDate: string,
  byDate: Map<string, number>,
  trendLookbackWeeks: number,
  seasonalityLookbackWeeks: number,
  holidayFactor: number,
): Pick<ForecastRow, "baseForecast" | "trendFactor" | "seasonalityFactor" | "forecastedCalls" | "historyDaysUsed"> {
  const trendWindowDays = trendLookbackWeeks * 7;
  const seasonalityWindowDays = seasonalityLookbackWeeks * 7;
  const maxWindowStart = addDays(targetDate, -Math.max(trendWindowDays, seasonalityWindowDays));

  const allPoints = [...byDate.entries()]
    .filter(([date]) => date >= maxWindowStart && date < targetDate)
    .map(([date, count]) => ({ date, count }));
  if (allPoints.length === 0) {
    return { baseForecast: null, trendFactor: null, seasonalityFactor: null, forecastedCalls: null, historyDaysUsed: 0 };
  }

  const trendWindowStart = addDays(targetDate, -trendWindowDays);
  const trendPoints = allPoints.filter((p) => p.date >= trendWindowStart);
  const basePoints = trendPoints.length > 0 ? trendPoints : allPoints;
  const baseForecast = avg(basePoints.map((p) => p.count));

  let trendFactor = 1;
  if (trendPoints.length >= 4) {
    const sorted = [...trendPoints].sort((a, b) => (a.date < b.date ? -1 : 1));
    const mid = Math.floor(sorted.length / 2);
    const olderAvg = avg(sorted.slice(0, mid).map((p) => p.count));
    const recentAvg = avg(sorted.slice(mid).map((p) => p.count));
    if (olderAvg > 0) trendFactor = clamp(recentAvg / olderAvg, 0.5, 2);
  }

  const seasonalityWindowStart = addDays(targetDate, -seasonalityWindowDays);
  const seasonalityPoints = allPoints.filter((p) => p.date >= seasonalityWindowStart);
  const targetWeekday = dayOfWeek(targetDate);
  const sameWeekdayPoints = seasonalityPoints.filter((p) => dayOfWeek(p.date) === targetWeekday);
  let seasonalityFactor = 1;
  if (sameWeekdayPoints.length > 0) {
    const overallAvg = avg(seasonalityPoints.map((p) => p.count));
    if (overallAvg > 0) seasonalityFactor = round2(avg(sameWeekdayPoints.map((p) => p.count)) / overallAvg);
  }

  const forecastedCalls = Math.max(0, Math.round(baseForecast * trendFactor * seasonalityFactor * holidayFactor));
  return { baseForecast: round2(baseForecast), trendFactor: round2(trendFactor), seasonalityFactor, forecastedCalls, historyDaysUsed: allPoints.length };
}

export async function getForecast(params: { from: string; to: string; queueId?: number; computedByUserId?: string }): Promise<ForecastRow[]> {
  const trendLookbackWeeks = getConfigNumber("forecast.trend_lookback_weeks", 4);
  const seasonalityLookbackWeeks = getConfigNumber("forecast.seasonality_lookback_weeks", 8);
  const holidayVolumeFactor = getConfigNumber("forecast.holiday_volume_factor", 1);

  const lookbackDays = Math.max(trendLookbackWeeks, seasonalityLookbackWeeks) * 7;
  const [historyByQueue, holidays] = await Promise.all([
    buildHistoryByQueue(params.queueId, addDays(params.from, -lookbackDays), params.to),
    listHolidays(),
  ]);
  const holidayDates = new Set(holidays.map((h) => h.holidayDate));

  const rows: ForecastRow[] = [];
  for (const [queueId, { queueName, byDate }] of historyByQueue) {
    for (let d = params.from; d <= params.to; d = addDays(d, 1)) {
      const holidayFactor = holidayDates.has(d) ? holidayVolumeFactor : 1;
      const calc = computeForecastForDate(d, byDate, trendLookbackWeeks, seasonalityLookbackWeeks, holidayFactor);
      rows.push({ businessDate: d, queueId, queueName, holidayFactor, actualOfferedCalls: byDate.get(d) ?? null, ...calc });
    }
  }

  await Promise.all(
    rows
      .filter((r): r is ForecastRow & { forecastedCalls: number } => r.forecastedCalls !== null)
      .map((r) =>
        recordCalculation({
          formulaCode: "CALL_VOLUME_FORECAST",
          formulaVersion: 1,
          entityType: "Queue",
          entityId: String(r.queueId),
          businessDate: r.businessDate,
          computedValue: r.forecastedCalls,
          inputsSnapshot: { baseForecast: r.baseForecast, trendFactor: r.trendFactor, seasonalityFactor: r.seasonalityFactor, holidayFactor: r.holidayFactor, historyDaysUsed: r.historyDaysUsed },
          computedByUserId: params.computedByUserId ?? null,
        }),
      ),
  );

  return rows.sort((a, b) => (a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : a.queueId - b.queueId));
}

/** Compares each date's forecast (computed from only the history available before it) against
 * what really happened, wherever both exist in range - build spec section 21's accuracy/MAE/
 * MAPE/bias. Reuses getForecast rather than recomputing, so this is always the same forecast
 * a caller would have seen, not a second implementation that could quietly disagree. */
export async function getForecastAccuracy(params: { from: string; to: string; queueId?: number; computedByUserId?: string }): Promise<ForecastAccuracySummary> {
  const rows = await getForecast(params);
  const evaluable = rows.filter((r) => r.forecastedCalls !== null && r.actualOfferedCalls !== null);
  if (evaluable.length === 0) return { queueId: params.queueId ?? null, daysEvaluated: 0, mae: null, mape: null, bias: null };

  const errors = evaluable.map((r) => r.forecastedCalls! - r.actualOfferedCalls!);
  const mae = round2(avg(errors.map(Math.abs)));
  const bias = round2(avg(errors));
  const mapeable = evaluable.filter((r) => r.actualOfferedCalls! > 0);
  const mape = mapeable.length > 0 ? round2(avg(mapeable.map((r) => Math.abs(r.forecastedCalls! - r.actualOfferedCalls!) / r.actualOfferedCalls!)) * 100) : null;

  const entityType = params.queueId ? "Queue" : "Company";
  const entityId = params.queueId ? String(params.queueId) : "ALL";
  const inputsSnapshot = { daysEvaluated: evaluable.length, from: params.from, to: params.to };
  await Promise.all([
    recordCalculation({ formulaCode: "FORECAST_MAE", formulaVersion: 1, entityType, entityId, businessDate: params.to, computedValue: mae, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }),
    recordCalculation({ formulaCode: "FORECAST_BIAS", formulaVersion: 1, entityType, entityId, businessDate: params.to, computedValue: bias, inputsSnapshot, computedByUserId: params.computedByUserId ?? null }),
    mape !== null
      ? recordCalculation({ formulaCode: "FORECAST_MAPE", formulaVersion: 1, entityType, entityId, businessDate: params.to, computedValue: mape, inputsSnapshot: { ...inputsSnapshot, mapeableDays: mapeable.length }, computedByUserId: params.computedByUserId ?? null })
      : Promise.resolve(),
  ]);

  return { queueId: params.queueId ?? null, daysEvaluated: evaluable.length, mae, mape, bias };
}
