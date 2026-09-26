import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import * as service from "./forecast.service.js";
import { forecastQuerySchema } from "./forecast.validation.js";

export const forecastRouter = Router();

forecastRouter.use(requireAuth, requirePermission("forecast.view"));

forecastRouter.get("/", async (req, res) => {
  const input = forecastQuerySchema.parse(req.query);
  const result = await service.getForecast({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

forecastRouter.get("/accuracy", async (req, res) => {
  const input = forecastQuerySchema.parse(req.query);
  const result = await service.getForecastAccuracy({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
