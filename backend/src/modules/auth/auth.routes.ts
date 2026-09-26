import { Router } from "express";
import type { ApiSuccess, LoginResponse } from "@mywfm/shared";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../errors/AppError.js";
import { requireAuth } from "../../middleware/auth.js";
import { toRequestContext } from "../../middleware/requestContext.js";
import * as authService from "./auth.service.js";
import { loginRequestSchema } from "./auth.validation.js";

export const authRouter = Router();

const REFRESH_COOKIE_NAME = "mywfm_refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

function setRefreshCookie(res: import("express").Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

authRouter.post("/login", async (req, res) => {
  const { email, password } = loginRequestSchema.parse(req.body);
  const ctx = toRequestContext(req);
  const result = await authService.login(email, password, ctx);

  setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
  const body: ApiSuccess<LoginResponse> = {
    success: true,
    data: { accessToken: result.accessToken, accessTokenExpiresAt: result.accessTokenExpiresAt, user: result.user },
  };
  res.status(200).json(body);
});

authRouter.post("/refresh", async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!rawRefreshToken) {
    throw new UnauthorizedError("No active session.");
  }

  const ctx = toRequestContext(req);
  const result = await authService.refresh(rawRefreshToken, ctx);

  setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
  const body: ApiSuccess<LoginResponse> = {
    success: true,
    data: { accessToken: result.accessToken, accessTokenExpiresAt: result.accessTokenExpiresAt, user: result.user },
  };
  res.status(200).json(body);
});

authRouter.post("/logout", async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (rawRefreshToken) {
    await authService.logout(rawRefreshToken, toRequestContext(req));
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.status(204).send();
});

authRouter.get("/me", requireAuth, (req, res) => {
  const body: ApiSuccess<typeof req.user> = { success: true, data: req.user };
  res.status(200).json(body);
});
