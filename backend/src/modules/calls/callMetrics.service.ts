import { getConfigNumber } from "../../config/appConfig.js";
import { recordCalculation } from "../formula/calculationLedger.js";
import * as repo from "./callMetrics.repository.js";
import type { CallMetricsRawRow } from "./callMetrics.repository.js";

export interface CallMetricsSummary {
  businessDate: string;
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  answerRatePct: number | null;
  abandonRatePct: number | null;
  ahtSeconds: number | null;
  serviceLevelPct: number | null;
  workloadHours: number;
}

export interface QueueCallMetrics extends CallMetricsSummary {
  queueId: number;
  queueName: string | null;
}

export interface ProcessCallMetrics extends CallMetricsSummary {
  processId: number;
  processName: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function serviceLevelThresholdSeconds(): number {
  return getConfigNumber("calls.service_level_threshold_seconds", 20);
}

function summarize(raw: {
  offeredCalls: number;
  answeredCalls: number;
  abandonedCalls: number;
  answeredHandleSecondsSum: number;
  answeredWithinThreshold: number;
}): Omit<CallMetricsSummary, "businessDate"> {
  const ahtSeconds = raw.answeredCalls > 0 ? round2(raw.answeredHandleSecondsSum / raw.answeredCalls) : null;
  return {
    offeredCalls: raw.offeredCalls,
    answeredCalls: raw.answeredCalls,
    abandonedCalls: raw.abandonedCalls,
    answerRatePct: raw.offeredCalls > 0 ? round2((raw.answeredCalls / raw.offeredCalls) * 100) : null,
    abandonRatePct: raw.offeredCalls > 0 ? round2((raw.abandonedCalls / raw.offeredCalls) * 100) : null,
    ahtSeconds,
    // Denominator is Offered (not Answered) - the stricter, more common SLA definition: a call
    // abandoned before the threshold counts against Service Level, not just a slow answer.
    serviceLevelPct: raw.offeredCalls > 0 ? round2((raw.answeredWithinThreshold / raw.offeredCalls) * 100) : null,
    workloadHours: round2((raw.offeredCalls * (ahtSeconds ?? 0)) / 3600),
  };
}

/** Only the derived ratios get a ledger row, matching staffing.service.ts's precedent: the raw
 * counts they're computed from are recorded in inputsSnapshot, not as their own ledger rows. */
async function recordMetricLedger(entityType: string, entityId: string, businessDate: string, summary: CallMetricsSummary, computedByUserId?: string): Promise<void> {
  const inputsSnapshot = {
    offeredCalls: summary.offeredCalls,
    answeredCalls: summary.answeredCalls,
    abandonedCalls: summary.abandonedCalls,
  };
  const writes: Promise<void>[] = [];
  const record = (formulaCode: string, computedValue: number | null) => {
    if (computedValue === null) return;
    writes.push(
      recordCalculation({ formulaCode, formulaVersion: 1, entityType, entityId, businessDate, computedValue, inputsSnapshot, computedByUserId: computedByUserId ?? null }),
    );
  };
  record("ANSWER_RATE_PCT", summary.answerRatePct);
  record("ABANDON_RATE_PCT", summary.abandonRatePct);
  record("AHT_SECONDS", summary.ahtSeconds);
  record("SERVICE_LEVEL_PCT", summary.serviceLevelPct);
  record("WORKLOAD_HOURS", summary.workloadHours);
  await Promise.all(writes);
}

export async function listByQueue(params: { from: string; to: string; queueId?: number; computedByUserId?: string }): Promise<QueueCallMetrics[]> {
  const raw = await repo.listCallMetricsRaw({ ...params, serviceLevelThresholdSeconds: serviceLevelThresholdSeconds() });
  const rows = raw.map((r) => ({ businessDate: r.businessDate, queueId: r.queueId, queueName: r.queueName, ...summarize(r) }));
  await Promise.all(rows.map((r) => recordMetricLedger("Queue", String(r.queueId), r.businessDate, r, params.computedByUserId)));
  return rows;
}

/**
 * Rolls the same per-queue raw counts up to (BusinessDate, ProcessId) by summing counts first,
 * then computing ratios once - never by averaging the per-queue percentages, which would be
 * mathematically wrong. Queues with no Process assigned (master.Queue.ProcessId is null - see
 * Admin > Queues) are excluded: their workload can't be attributed to a roster requirement's
 * process, and that's a real, honest gap until someone assigns it, not something to guess at.
 */
export async function listByProcess(params: { from: string; to: string; processId?: number; computedByUserId?: string }): Promise<ProcessCallMetrics[]> {
  const raw = await repo.listCallMetricsRaw({ ...params, serviceLevelThresholdSeconds: serviceLevelThresholdSeconds() });
  const grouped = new Map<string, { businessDate: string; processId: number; processName: string | null } & Omit<CallMetricsRawRow, "businessDate" | "queueId" | "queueName" | "processId" | "processName">>();
  for (const r of raw) {
    if (r.processId === null) continue;
    const key = `${r.businessDate}|${r.processId}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        businessDate: r.businessDate,
        processId: r.processId,
        processName: r.processName,
        offeredCalls: r.offeredCalls,
        answeredCalls: r.answeredCalls,
        abandonedCalls: r.abandonedCalls,
        answeredHandleSecondsSum: r.answeredHandleSecondsSum,
        answeredWithinThreshold: r.answeredWithinThreshold,
      });
    } else {
      existing.offeredCalls += r.offeredCalls;
      existing.answeredCalls += r.answeredCalls;
      existing.abandonedCalls += r.abandonedCalls;
      existing.answeredHandleSecondsSum += r.answeredHandleSecondsSum;
      existing.answeredWithinThreshold += r.answeredWithinThreshold;
    }
  }
  const rows = [...grouped.values()]
    .map((g) => ({ businessDate: g.businessDate, processId: g.processId, processName: g.processName, ...summarize(g) }))
    .sort((a, b) => (a.businessDate < b.businessDate ? 1 : a.businessDate > b.businessDate ? -1 : 0));
  await Promise.all(rows.map((r) => recordMetricLedger("Process", String(r.processId), r.businessDate, r, params.computedByUserId)));
  return rows;
}
