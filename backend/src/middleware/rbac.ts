import type { NextFunction, Request, Response } from "express";
import type { PermissionCode } from "@mywfm/shared";
import { ForbiddenError, UnauthorizedError } from "../errors/AppError.js";

/**
 * Server-side permission enforcement (build spec section 43: "Never rely
 * solely on frontend permission hiding. Backend must enforce permissions.").
 * Must run after requireAuth. Requires ALL of the given permission codes.
 */
export function requirePermission(...permissionCodes: PermissionCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const missing = permissionCodes.filter((code) => !req.user!.permissions.includes(code));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing required permission(s): ${missing.join(", ")}`);
    }
    next();
  };
}
