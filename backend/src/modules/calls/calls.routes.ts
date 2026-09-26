import multer from "multer";
import { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { ValidationError } from "../../errors/AppError.js";
import { isCallsSource, importCallsFile } from "./callsImporter.js";
import * as repo from "./calls.repository.js";
import * as metrics from "./callMetrics.service.js";
import { agentIntervalQuerySchema, callMetricsByProcessQuerySchema, callMetricsByQueueQuerySchema, queueIntervalQuerySchema } from "./calls.validation.js";

export const callsRouter = Router();

callsRouter.use(requireAuth, requirePermission("calls.view"));

callsRouter.get("/queue-intervals", async (req, res) => {
  const input = queueIntervalQuerySchema.parse(req.query);
  const result = await repo.listQueueIntervals(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

callsRouter.get("/agent-intervals", async (req, res) => {
  const input = agentIntervalQuerySchema.parse(req.query);
  const result = await repo.listAgentIntervals(input);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

callsRouter.get("/metrics/by-queue", async (req, res) => {
  const input = callMetricsByQueueQuerySchema.parse(req.query);
  const result = await metrics.listByQueue({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

callsRouter.get("/metrics/by-process", async (req, res) => {
  const input = callMetricsByProcessQuerySchema.parse(req.query);
  const result = await metrics.listByProcess({ ...input, computedByUserId: req.user!.userId });
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

// Binary (.xlsx) upload - unlike the org-hierarchy TSV/CSV upload, a real phone-system export
// is a spreadsheet, so this is the first import.execute-gated endpoint to need multer rather
// than a raw text body (see documentation/imports.md).
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

callsRouter.post("/import/:source", requirePermission("import.execute"), upload.single("file"), async (req, res) => {
  const source = String(req.params.source);
  if (!isCallsSource(source)) {
    throw new ValidationError(`Unknown calls source "${source}".`);
  }
  if (!req.file) {
    throw new ValidationError("A file upload (multipart field \"file\") is required.");
  }

  const result = await importCallsFile(source, req.file.buffer, {
    fileName: req.file.originalname,
    fileSizeBytes: req.file.size,
    uploadedByUserId: req.user!.userId,
  });

  res.status(201).json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});
