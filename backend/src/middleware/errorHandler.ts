import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@mywfm/shared";
import { AppError, ValidationError } from "../errors/AppError.js";
import { logger } from "../logger/logger.js";

/**
 * The one place an error becomes an HTTP response. Every error gets an
 * errorId that also goes into the server-side log line, so a user-facing
 * "Something went wrong" can always be traced back to full technical detail
 * without ever putting that detail in the response body (build spec
 * section 65).
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const errorId = randomUUID();

  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_root";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    const validationError = new ValidationError("The request contains invalid fields.", fieldErrors);
    respond(res, req, validationError, errorId);
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ errorId, code: err.code, err, ...err.logContext, correlationId: req.correlationId }, err.message);
    } else {
      logger.warn({ errorId, code: err.code, correlationId: req.correlationId }, err.message);
    }
    respond(res, req, err, errorId);
    return;
  }

  logger.error({ errorId, err, correlationId: req.correlationId }, "Unhandled exception");
  const body: ApiErrorBody = {
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred. Please try again.", errorId },
  };
  res.status(500).json(body);
}

function respond(res: Response, req: Request, err: AppError, errorId: string): void {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      errorId,
      ...(err instanceof ValidationError && err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
    },
  };
  res.status(err.statusCode).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const errorId = randomUUID();
  const body: ApiErrorBody = {
    success: false,
    error: { code: "NOT_FOUND", message: `No route matches ${req.method} ${req.path}`, errorId },
  };
  res.status(404).json(body);
}
