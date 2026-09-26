import jwt from "jsonwebtoken";
import type { AccessTokenClaims, AuthenticatedUser } from "@mywfm/shared";
import { env } from "../../config/env.js";
import { getConfigNumber } from "../../config/appConfig.js";

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export function signAccessToken(user: AuthenticatedUser): IssuedAccessToken {
  const ttlMinutes = getConfigNumber("security.access_token_ttl_minutes", 15);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const payload: Omit<AccessTokenClaims, "iat" | "exp"> = {
    sub: user.userId,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    permissions: user.permissions,
  };

  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: `${ttlMinutes}m` });
  return { token, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
}
