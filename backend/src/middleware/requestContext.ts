import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { RequestContext } from "../modules/auth/auth.service.js";

export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  req.correlationId = (req.headers["x-correlation-id"] as string | undefined) || randomUUID();
  next();
}

export function toRequestContext(req: Request): RequestContext {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    correlationId: req.correlationId,
  };
}
