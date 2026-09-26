import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "../src/modules/auth/password.js";

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    expect(await verifyPassword("CorrectHorseBattery9", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    expect(await verifyPassword("WrongPassword1", hash)).toBe(false);
  });

  it("never stores the plaintext in the hash", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    expect(hash).not.toContain("CorrectHorseBattery9");
  });
});

describe("password policy", () => {
  it("accepts a password meeting length, case and digit requirements", () => {
    const result = validatePasswordPolicy("GoodPassword1");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a too-short password", () => {
    const result = validatePasswordPolicy("Sh0rt");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/at least/i);
  });

  it("rejects a password with no digit", () => {
    const result = validatePasswordPolicy("NoDigitsHere");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/digit/i);
  });

  it("rejects a password with only one letter case", () => {
    const result = validatePasswordPolicy("alllowercase1");
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/uppercase/i);
  });
});
