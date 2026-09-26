import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@mywfm/shared";

const listDailyCallVolume = vi.fn();
vi.mock("../src/modules/forecast/forecast.repository.js", () => ({ listDailyCallVolume }));

const listHolidays = vi.fn(async () => [] as { id: number; holidayDate: string; holidayName: string; locationId: number | null }[]);
vi.mock("../src/modules/masterdata/masterdata.repository.js", () => ({ listHolidays }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

// Real defaults (trend=4wk, seasonality=8wk) pass through via `fallback`; only the holiday
// factor is overridden to something other than 1, so a test can actually detect whether it
// was applied (x1 is indistinguishable from "not applied").
const getConfigNumber = vi.fn((key: string, fallback: number) => (key === "forecast.holiday_volume_factor" ? 0.5 : fallback));
vi.mock("../src/config/appConfig.js", () => ({ getConfigNumber }));

const { getForecast, getForecastAccuracy } = await import("../src/modules/forecast/forecast.service.js");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function volumeRow(businessDate: string, offeredCalls: number, queueId = 1, queueName: string | null = "English Queue") {
  return { businessDate, queueId, queueName, offeredCalls };
}

beforeEach(() => {
  listDailyCallVolume.mockReset();
  listHolidays.mockReset().mockResolvedValue([]);
  recordCalculation.mockClear();
});

describe("getForecast", () => {
  it("derives Seasonality Factor from real same-weekday history without a confounding trend", async () => {
    const target = "2026-10-01";
    const rows = [];
    for (let i = 1; i <= 8; i++) {
      const sameWeekday = addDays(target, -7 * i);
      rows.push(volumeRow(sameWeekday, 100));
      for (let offset = 1; offset <= 6; offset++) {
        rows.push(volumeRow(addDays(sameWeekday, offset), 50));
      }
    }
    listDailyCallVolume.mockResolvedValue(rows);

    const [row] = await getForecast({ from: target, to: target });

    expect(row).toMatchObject({ businessDate: target, queueId: 1, holidayFactor: 1 });
    expect(row!.baseForecast).toBe(round2((2 * 100 + 12 * 50) / 14)); // trend window = last 4 weeks, same 100/50 split each week
    expect(row!.trendFactor).toBe(1); // no genuine trend - recent vs older half of the trend window are identical
    expect(row!.seasonalityFactor).toBe(round2(100 / ((8 * 100 + 48 * 50) / 56))); // 1.75
    expect(row!.forecastedCalls).toBe(Math.round(row!.baseForecast! * 1 * row!.seasonalityFactor! * 1));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "CALL_VOLUME_FORECAST", entityType: "Queue", entityId: "1", businessDate: target, computedValue: row!.forecastedCalls }));
  });

  it("derives Trend Factor from the recent half vs. the older half of the trend window, clamped to [0.5, 2]", async () => {
    const target = "2026-11-01";
    const rows = [];
    for (let i = 28; i >= 15; i--) rows.push(volumeRow(addDays(target, -i), 50)); // older half
    for (let i = 14; i >= 1; i--) rows.push(volumeRow(addDays(target, -i), 100)); // recent half
    listDailyCallVolume.mockResolvedValue(rows);

    const [row] = await getForecast({ from: target, to: target });

    expect(row!.trendFactor).toBe(2); // 100 / 50, exactly at the clamp boundary
    expect(row!.baseForecast).toBe(75); // avg of the 28-day trend window (14 x 50 + 14 x 100)
    expect(row!.forecastedCalls).toBe(150); // 75 x 2 x 1 (seasonality) x 1 (holiday)
  });

  it("reports insufficient history as null rather than a fabricated forecast, for a queue with zero historical rows", async () => {
    listDailyCallVolume.mockResolvedValue([]);

    const [row] = await getForecast({ from: "2026-10-01", to: "2026-10-01", queueId: 42 });

    expect(row).toMatchObject({ queueId: 42, baseForecast: null, trendFactor: null, seasonalityFactor: null, forecastedCalls: null, historyDaysUsed: 0 });
    expect(recordCalculation).not.toHaveBeenCalled();
  });

  it("applies the configured holiday factor only on a real master.Holiday date", async () => {
    const target = "2026-12-25";
    const rows = [];
    for (let i = 1; i <= 28; i++) rows.push(volumeRow(addDays(target, -i), 100));
    listDailyCallVolume.mockResolvedValue(rows);
    listHolidays.mockResolvedValue([{ id: 1, holidayDate: target, holidayName: "Christmas", locationId: null }]);

    const [row] = await getForecast({ from: target, to: target });

    expect(row!.holidayFactor).toBe(0.5);
    expect(row!.forecastedCalls).toBe(Math.round(100 * 1 * 1 * 0.5));
  });
});

describe("getForecastAccuracy", () => {
  it("computes MAE/MAPE/Bias from exactly the same per-day forecasts getForecast would return, compared against each day's real actual", async () => {
    // Two consecutive days, each with a deliberately different real actual - accuracy math is
    // the focus here, not the forecast algorithm itself (covered by the tests above), so this
    // reads the real forecast getForecast produces rather than hand-predicting it.
    const day1 = "2026-10-01";
    const day2 = addDays(day1, 1);
    const rows = [];
    for (let i = 1; i <= 56; i++) rows.push(volumeRow(addDays(day1, -i), 100));
    rows.push(volumeRow(day1, 90));
    rows.push(volumeRow(day2, 130));
    listDailyCallVolume.mockResolvedValue(rows);

    const forecastRows = await getForecast({ from: day1, to: day2 });
    recordCalculation.mockClear();
    const result = await getForecastAccuracy({ from: day1, to: day2 });

    const [f1, f2] = [forecastRows.find((r) => r.businessDate === day1)!, forecastRows.find((r) => r.businessDate === day2)!];
    expect(f1.forecastedCalls).not.toBeNull();
    expect(f2.forecastedCalls).not.toBeNull();
    const errors = [f1.forecastedCalls! - 90, f2.forecastedCalls! - 130];
    expect(result.daysEvaluated).toBe(2);
    expect(result.mae).toBe(round2((Math.abs(errors[0]!) + Math.abs(errors[1]!)) / 2));
    expect(result.bias).toBe(round2((errors[0]! + errors[1]!) / 2));
    expect(result.mape).toBe(round2(((Math.abs(errors[0]!) / 90 + Math.abs(errors[1]!) / 130) / 2) * 100));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "FORECAST_MAE", entityType: "Company", entityId: "ALL", computedValue: result.mae }));
  });

  it("reports zero days evaluated (not a misleading zero-error) when no date has both a forecast and a real actual", async () => {
    listDailyCallVolume.mockResolvedValue([]);

    const result = await getForecastAccuracy({ from: "2026-10-01", to: "2026-10-01" });

    expect(result).toMatchObject({ daysEvaluated: 0, mae: null, mape: null, bias: null });
  });
});
