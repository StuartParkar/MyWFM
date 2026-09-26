import type { AuthenticatedUser, LoginResponse } from "@mywfm/shared";
import { UnauthorizedError } from "../../errors/AppError.js";
import { recordAudit } from "../audit/audit.service.js";
import {
  findActiveRefreshTokenByHash,
  getUserAuthProfile,
  insertRefreshToken,
  recordFailedLogin,
  resetFailedLoginsAndTouchLogin,
  revokeRefreshToken,
} from "./auth.repository.js";
import { signAccessToken, verifyAccessToken } from "./jwt.js";
import { verifyPassword } from "./password.js";
import { hashRefreshToken, issueRefreshToken } from "./refreshToken.js";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string;
}

export interface LoginResult extends LoginResponse {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

function toAuthenticatedUser(profile: { userId: string; email: string; displayName: string; roles: AuthenticatedUser["roles"]; permissions: AuthenticatedUser["permissions"] }): AuthenticatedUser {
  return {
    userId: profile.userId,
    email: profile.email,
    displayName: profile.displayName,
    roles: profile.roles,
    permissions: profile.permissions,
  };
}

const GENERIC_LOGIN_FAILURE = "Invalid email or password.";

export async function login(email: string, password: string, ctx: RequestContext): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const profile = await getUserAuthProfile({ email: normalizedEmail });

  if (!profile || !profile.isActive) {
    await recordAudit({
      entityType: "User",
      action: "LOGIN_FAILURE",
      reason: "Unknown or inactive account",
      referenceId: normalizedEmail,
      ipAddress: ctx.ipAddress,
      correlationId: ctx.correlationId,
    });
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE);
  }

  if (profile.lockedUntil && profile.lockedUntil.getTime() > Date.now()) {
    await recordAudit({
      entityType: "User",
      entityId: profile.userId,
      action: "LOGIN_FAILURE",
      reason: "Account locked",
      ipAddress: ctx.ipAddress,
      correlationId: ctx.correlationId,
    });
    throw new UnauthorizedError("This account is temporarily locked due to repeated failed sign-ins. Try again later.");
  }

  const passwordValid = await verifyPassword(password, profile.passwordHash);
  if (!passwordValid) {
    await recordFailedLogin(profile.userId);
    await recordAudit({
      entityType: "User",
      entityId: profile.userId,
      action: "LOGIN_FAILURE",
      reason: "Incorrect password",
      ipAddress: ctx.ipAddress,
      correlationId: ctx.correlationId,
    });
    throw new UnauthorizedError(GENERIC_LOGIN_FAILURE);
  }

  await resetFailedLoginsAndTouchLogin(profile.userId);

  const authenticatedUser = toAuthenticatedUser(profile);
  const accessToken = signAccessToken(authenticatedUser);
  const refreshToken = issueRefreshToken();
  await insertRefreshToken({
    userId: profile.userId,
    tokenHash: refreshToken.tokenHash,
    expiresAt: refreshToken.expiresAt,
    createdByIp: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  await recordAudit({
    entityType: "User",
    entityId: profile.userId,
    action: "LOGIN_SUCCESS",
    ipAddress: ctx.ipAddress,
    correlationId: ctx.correlationId,
  });

  return {
    accessToken: accessToken.token,
    accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
    user: authenticatedUser,
    refreshToken: refreshToken.token,
    refreshTokenExpiresAt: refreshToken.expiresAt,
  };
}

export async function refresh(rawRefreshToken: string, ctx: RequestContext): Promise<LoginResult> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const activeToken = await findActiveRefreshTokenByHash(tokenHash);
  if (!activeToken) {
    throw new UnauthorizedError("Your session has expired. Please sign in again.");
  }

  const profile = await getUserAuthProfile({ userId: activeToken.userId });
  if (!profile || !profile.isActive) {
    await revokeRefreshToken(activeToken.refreshTokenId);
    throw new UnauthorizedError("Your session has expired. Please sign in again.");
  }

  const authenticatedUser = toAuthenticatedUser(profile);
  const accessToken = signAccessToken(authenticatedUser);
  const newRefreshToken = issueRefreshToken();

  await insertRefreshToken({
    userId: profile.userId,
    tokenHash: newRefreshToken.tokenHash,
    expiresAt: newRefreshToken.expiresAt,
    createdByIp: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  await revokeRefreshToken(activeToken.refreshTokenId, undefined);

  return {
    accessToken: accessToken.token,
    accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
    user: authenticatedUser,
    refreshToken: newRefreshToken.token,
    refreshTokenExpiresAt: newRefreshToken.expiresAt,
  };
}

export async function logout(rawRefreshToken: string, ctx: RequestContext): Promise<void> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const activeToken = await findActiveRefreshTokenByHash(tokenHash);
  if (activeToken) {
    await revokeRefreshToken(activeToken.refreshTokenId);
    await recordAudit({
      entityType: "User",
      entityId: activeToken.userId,
      action: "LOGOUT",
      ipAddress: ctx.ipAddress,
      correlationId: ctx.correlationId,
    });
  }
}

export { verifyAccessToken };
