import { beforeEach, describe, expect, it, vi } from "vitest";

const listCallMetricsRaw = vi.fn();
vi.mock("../src/modules/calls/callMetrics.repository.js", () => ({ listCallMetricsRaw }));

const recordCalculation = vi.fn(async () => undefined);
vi.mock("../src/modules/formula/calculationLedger.js", () => ({ recordCalculation }));

const { listByQueue, listByProcess } = await import("../src/modules/calls/callMetrics.service.js");

function rawRow(overrides: Partial<{
  businessDate: string;
  queueId: number;
  queueName: string | null;
  processId: number | null;
  processName: string | null;
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  answeredHandleSecondsSum: number;
  answeredWithinThreshold: number;
}>) {
  return {
    businessDate: "2026-09-25",
    queueId: 1,
    queueName: "English - Queue 1",
    processId: 10,
    processName: "Bookings",
    offeredCalls: 100,
    answeredCalls: 80,
    abandonedCalls: 20,
    answeredHandleSecondsSum: 80 * 300,
    answeredWithinThreshold: 60,
    ...overrides,
  };
}

beforeEach(() => {
  listCallMetricsRaw.mockReset();
  recordCalculation.mockClear();
});

describe("listByQueue", () => {
  it("computes Answer Rate/Abandon Rate/AHT/Service Level/Workload per queue/day and records the derived ratios to the ledger", async () => {
    listCallMetricsRaw.mockResolvedValue([rawRow({})]);

    const [row] = await listByQueue({ from: "2026-09-25", to: "2026-09-25" });

    expect(row).toMatchObject({
      offeredCalls: 100,
      answeredCalls: 80,
      abandonedCalls: 20,
      answerRatePct: 80, // 80/100 * 100
      abandonRatePct: 20, // 20/100 * 100
      ahtSeconds: 300, // 24000 / 80
      serviceLevelPct: 60, // 60/100 * 100 (denominator is Offered, not Answered)
      workloadHours: round2((100 * 300) / 3600),
    });
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ANSWER_RATE_PCT", entityType: "Queue", entityId: "1", computedValue: 80 }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "AHT_SECONDS", computedValue: 300 }));
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "WORKLOAD_HOURS" }));
    // Raw counts are not their own ledger entries - only the derived ratios are (matches
    // staffing.service.ts's precedent: inputs live in inputsSnapshot, not as separate rows).
    expect(recordCalculation).not.toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "OFFERED_CALLS" }));
  });

  it("reports null percentages (not a divide-by-zero) when a queue had zero offered calls, without writing those ledger rows", async () => {
    listCallMetricsRaw.mockResolvedValue([rawRow({ offeredCalls: 0, answeredCalls: 0, abandonedCalls: 0, answeredHandleSecondsSum: 0, answeredWithinThreshold: 0 })]);

    const [row] = await listByQueue({ from: "2026-09-25", to: "2026-09-25" });

    expect(row).toMatchObject({ answerRatePct: null, abandonRatePct: null, ahtSeconds: null, serviceLevelPct: null, workloadHours: 0 });
    expect(recordCalculation).not.toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ANSWER_RATE_PCT" }));
  });
});

describe("listByProcess", () => {
  it("sums raw counts across queues sharing a process before computing ratios, rather than averaging each queue's own percentage", async () => {
    // Queue A: 100 offered, 50 answered. Queue B: 50 offered, 50 answered. Averaging the two
    // queues' own answer rates (50% and 100%) would wrongly give 75% - summing first gives
    // the true rate: 100 answered / 150 offered = 66.67%.
    listCallMetricsRaw.mockResolvedValue([
      rawRow({ queueId: 1, queueName: "Queue A", offeredCalls: 100, answeredCalls: 50, abandonedCalls: 50, answeredHandleSecondsSum: 50 * 200, answeredWithinThreshold: 40 }),
      rawRow({ queueId: 2, queueName: "Queue B", offeredCalls: 50, answeredCalls: 50, abandonedCalls: 0, answeredHandleSecondsSum: 50 * 400, answeredWithinThreshold: 45 }),
    ]);

    const [row] = await listByProcess({ from: "2026-09-25", to: "2026-09-25" });

    expect(row).toMatchObject({
      processId: 10,
      offeredCalls: 150,
      answeredCalls: 100,
      answerRatePct: round2((100 / 150) * 100),
      ahtSeconds: round2((50 * 200 + 50 * 400) / 100),
    });
    expect(recordCalculation).toHaveBeenCalledWith(expect.objectContaining({ formulaCode: "ANSWER_RATE_PCT", entityType: "Process", entityId: "10" }));
  });

  it("excludes a queue with no Process assigned rather than guessing which process its workload belongs to", async () => {
    listCallMetricsRaw.mockResolvedValue([rawRow({ queueId: 3, processId: null, processName: null })]);

    const rows = await listByProcess({ from: "2026-09-25", to: "2026-09-25" });

    expect(rows).toHaveLength(0);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
