import express, { Router } from "express";
import type { ApiSuccess } from "@mywfm/shared";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { ValidationError } from "../../errors/AppError.js";
import * as importRepo from "./import.repository.js";
import { importEmployeeHierarchy } from "./orgHierarchyImporter.js";

export const importsRouter = Router();

importsRouter.use(requireAuth);

importsRouter.get("/", requirePermission("import.view"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const result = await importRepo.listImportRuns(page, pageSize);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

// Text-body upload (the source files this phase handles - TSV/CSV - are
// plain text; a binary-file import type, e.g. Excel, would need multer/
// formidable instead - not added until a real type needs it).
const textBody = express.text({ type: () => true, limit: "10mb" });

importsRouter.post("/org-hierarchy", requirePermission("import.execute"), textBody, async (req, res) => {
  const fileName = typeof req.query.fileName === "string" ? req.query.fileName : "upload.tsv";
  const text = req.body as string;
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    throw new ValidationError("Request body must be the file's text content.");
  }

  const result = await importEmployeeHierarchy(text, {
    fileName,
    fileSizeBytes: Buffer.byteLength(text, "utf8"),
    uploadedByUserId: req.user!.userId,
  });

  res.status(201).json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

importsRouter.get("/data-quality", requirePermission("dataquality.view"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const result = await importRepo.listDataQualityIssues(page, pageSize, status);
  res.json({ success: true, data: result } satisfies ApiSuccess<typeof result>);
});

importsRouter.patch("/data-quality/:id", requirePermission("dataquality.view"), async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status ?? "");
  if (!["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"].includes(status)) {
    throw new ValidationError('status must be one of OPEN, ACKNOWLEDGED, RESOLVED, IGNORED.');
  }
  await importRepo.setDataQualityIssueStatus(id, status);
  res.status(204).send();
});
