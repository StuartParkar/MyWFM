import { getConfigNumber } from "../../config/appConfig.js";
import { logger } from "../../logger/logger.js";
import { getHealthReport } from "./health.service.js";
import { insertHealthSnapshot } from "./health.repository.js";

export interface HealthSnapshotSamplerHandle {
  stop(): void;
}

/**
 * Periodic sampler behind System Health's History view (Phase 11) - the live
 * GET /detail route only ever answered "right now"; this is what makes a
 * later "what did health look like last Tuesday" question answerable at all.
 * A failed sample (most likely the database being down, which is itself
 * useful to have recorded, but can't be while the very thing that's down is
 * what a snapshot would be inserted into) is logged and skipped, never
 * allowed to crash the process a health check is supposed to be reporting on.
 */
export function startHealthSnapshotSampler(): HealthSnapshotSamplerHandle {
  let stopped = false;
  let sampling = false;

  const intervalMinutes = getConfigNumber("system.health_snapshot_interval_minutes", 15);
  const timer = setInterval(
    () => {
      if (stopped || sampling) return;
      sampling = true;
      void tick().finally(() => {
        sampling = false;
      });
    },
    Math.max(1, intervalMinutes) * 60_000,
  );

  async function tick(): Promise<void> {
    try {
      const report = await getHealthReport();
      await insertHealthSnapshot(report);
    } catch (err) {
      logger.warn({ err }, "Health snapshot sampling failed (database likely unavailable)");
    }
  }

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
