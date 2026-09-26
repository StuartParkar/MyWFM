import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { AuthenticatedUser } from "@mywfm/shared";
import { signAccessToken, verifyAccessToken } from "../src/modules/auth/jwt.js";

const user: AuthenticatedUser = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "wfm.lead@example.com",
  displayName: "WFM Lead",
  roles: ["WFM"],
  permissions: ["audit.view", "system.health.view"],
};

describe("access tokens", () => {
  it("round-trips claims through sign and verify", () => {
    const { token } = signAccessToken(user);
    const claims = verifyAccessToken(token);

    expect(claims.sub).toBe(user.userId);
    expect(claims.email).toBe(user.email);
    expect(claims.roles).toEqual(user.roles);
    expect(claims.permissions).toEqual(user.permissions);
  });

  it("rejects a tampered token", () => {
    const { token } = signAccessToken(user);
    const tampered = `${token.slice(0, -2)}xx`;
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("rejects a token signed with a different secret", () => {
    const foreignToken = jwt.sign({ sub: user.userId }, "a-completely-different-secret-value");
    expect(() => verifyAccessToken(foreignToken)).toThrow();
  });
});
