import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { resolveGlobalBusinessDate } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { getConfigString } from "../../config/appConfig.js";

export const businessDayRouter = Router();

/**
 * What "today" means company-wide (build spec section 9's "configurable business day
 * start") - see shared/src/businessDate.ts's resolveGlobalBusinessDate and
 * frontend/src/lib/filters/businessToday.ts, which calls this instead of guessing from the
 * browser's clock. Also returns the configured timezone itself: a manual attendance entry
 * form must interpret what an admin types as a time in *this* timezone, not the admin's own
 * browser timezone, which may not match (see frontend's operations/attendance page).
 */
businessDayRouter.get("/today", requireAuth, (_req, res) => {
  const timezone = getConfigString("business_day.timezone", "Asia/Kolkata");
  const dayStartTime = getConfigString("business_day.start_time", "00:00");
  const businessDate = resolveGlobalBusinessDate(new Date().toISOString(), timezone, dayStartTime);
  res.json({ success: true, data: { businessDate, timezone } } satisfies ApiSuccess<{ businessDate: string; timezone: string }>);
});
