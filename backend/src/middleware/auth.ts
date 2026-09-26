import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UnauthorizedError } from "../errors/AppError.js";
import { verifyAccessToken } from "../modules/auth/jwt.js";

/**
 * Verifies the access token and attaches req.user. This is the only place
 * that trusts a JWT's claims - every downstream permission check
 * (middleware/rbac.ts) reads from req.user, never from the raw header again.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = header.slice("Bearer ".length);
  try {
    const claims = verifyAccessToken(token);
    req.user = {
      userId: claims.sub,
      email: claims.email,
      displayName: claims.displayName,
      roles: claims.roles,
      permissions: claims.permissions,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Your session has expired. Please sign in again.");
    }
    throw new UnauthorizedError("Invalid access token.");
  }
}
