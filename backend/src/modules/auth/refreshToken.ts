import { createHmac, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { getConfigNumber } from "../../config/appConfig.js";

export interface IssuedRefreshToken {
  /** Raw token - only ever returned to the client, never stored. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

function hashToken(rawToken: string): string {
  return createHmac("sha256", env.JWT_REFRESH_PEPPER).update(rawToken).digest("hex");
}

export function issueRefreshToken(): IssuedRefreshToken {
  const ttlDays = getConfigNumber("security.refresh_token_ttl_days", 7);
  const token = randomBytes(48).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  };
}

export function hashRefreshToken(rawToken: string): string {
  return hashToken(rawToken);
}
