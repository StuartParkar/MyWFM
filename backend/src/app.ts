import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Request } from "express";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestContext } from "./middleware/requestContext.js";
import { pinoInstance } from "./logger/logger.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { masterDataRouter } from "./modules/masterdata/masterdata.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { importsRouter } from "./modules/imports/import.routes.js";
import { rosterRouter } from "./modules/roster/roster.routes.js";
import { attendanceRouter } from "./modules/attendance/attendance.routes.js";
import { businessDayRouter } from "./modules/businessday/businessday.routes.js";
import { callsRouter } from "./modules/calls/calls.routes.js";
import { shrinkageRouter } from "./modules/shrinkage/shrinkage.routes.js";
import { staffingRouter } from "./modules/staffing/staffing.routes.js";
import { formulaRouter } from "./modules/formula/formula.routes.js";
import { forecastRouter } from "./modules/forecast/forecast.routes.js";
import { controlTowerRouter } from "./modules/controlTower/controlTower.routes.js";
import { intradayRouter } from "./modules/intraday/intraday.routes.js";
import { workforceRouter } from "./modules/workforce/workforce.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger: pinoInstance,
      genReqId: (req) => (req as Request).correlationId,
      autoLogging: { ignore: (req) => req.url === "/api/system-health" },
    }),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/system-health", healthRouter);
  app.use("/api/master-data", masterDataRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/roster", rosterRouter);
  app.use("/api/attendance", attendanceRouter);
  app.use("/api/business-day", businessDayRouter);
  app.use("/api/calls", callsRouter);
  app.use("/api/shrinkage", shrinkageRouter);
  app.use("/api/staffing", staffingRouter);
  app.use("/api/formulas", formulaRouter);
  app.use("/api/forecast", forecastRouter);
  app.use("/api/control-tower", controlTowerRouter);
  app.use("/api/intraday", intradayRouter);
  app.use("/api/workforce", workforceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
