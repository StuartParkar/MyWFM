import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../errors/AppError.js";

/**
 * Defense-in-depth CSRF mitigation for the two routes authenticated only by
 * a cookie (/api/auth/refresh, /api/auth/logout - see documentation/security.md
 * for why every other route's bearer-token requirement already makes it
 * CSRF-immune). A cross-site <form> POST cannot set a custom header without
 * triggering a CORS preflight, which this server's cors() config (a single
 * allowed origin) would reject - so requiring this header blocks the classic
 * form-based CSRF submission even before SameSite=Lax's own protection.
 */
export function requireFetchHeader(req: Request, _res: Response, next: NextFunction): void {
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
    throw new ForbiddenError("This endpoint must be called via fetch/XHR, not a plain form submission.");
  }
  next();
}
