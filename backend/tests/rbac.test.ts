import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { AuthenticatedUser } from "@mywfm/shared";
import { requirePermission } from "../src/middleware/rbac.js";
import { ForbiddenError, UnauthorizedError } from "../src/errors/AppError.js";

function fakeReq(user?: AuthenticatedUser): Request {
  return { user } as unknown as Request;
}

describe("requirePermission middleware", () => {
  it("calls next() when the user has every required permission", () => {
    const req = fakeReq({
      userId: "u1",
      email: "a@example.com",
      displayName: "A",
      roles: ["ADMIN"],
      permissions: ["config.view", "config.manage"],
    });
    const next = vi.fn();

    requirePermission("config.view")(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("throws ForbiddenError when a permission is missing", () => {
    const req = fakeReq({
      userId: "u1",
      email: "a@example.com",
      displayName: "A",
      roles: ["WFM"],
      permissions: ["config.view"],
    });
    const next = vi.fn();

    expect(() => requirePermission("config.manage")(req, {} as Response, next)).toThrow(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when there is no authenticated user", () => {
    const req = fakeReq(undefined);
    const next = vi.fn();

    expect(() => requirePermission("config.view")(req, {} as Response, next)).toThrow(UnauthorizedError);
  });

  it("requires ALL listed permissions, not just one", () => {
    const req = fakeReq({
      userId: "u1",
      email: "a@example.com",
      displayName: "A",
      roles: ["WFM"],
      permissions: ["config.view"],
    });
    const next = vi.fn();

    expect(() => requirePermission("config.view", "config.manage")(req, {} as Response, next)).toThrow(ForbiddenError);
  });
});
