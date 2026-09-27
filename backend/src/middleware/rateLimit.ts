import rateLimit from "express-rate-limit";
import { TooManyRequestsError } from "../errors/AppError.js";

/**
 * Scoped to /api/auth/login and /api/auth/refresh (see app.ts). The account
 * lockout in auth.repository.ts only engages once an email resolves to a
 * real, active account - this limiter is what actually caps the cost of
 * hammering the endpoint with unknown emails or a distributed brute force.
 * Keyed by IP (express-rate-limit's default), not by email, since the
 * attacker controls the email field.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError("Too many authentication attempts. Please try again later."));
  },
});
