import bcrypt from "bcryptjs";
import { getConfigNumber } from "../../config/appConfig.js";

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/** Config-driven (config.security.password_min_length), never hard-coded. */
export function validatePasswordPolicy(plainPassword: string): PasswordPolicyResult {
  const minLength = getConfigNumber("security.password_min_length", 10);
  const errors: string[] = [];

  if (plainPassword.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long.`);
  }
  if (!/[a-z]/.test(plainPassword) || !/[A-Z]/.test(plainPassword)) {
    errors.push("Password must contain both uppercase and lowercase letters.");
  }
  if (!/[0-9]/.test(plainPassword)) {
    errors.push("Password must contain at least one digit.");
  }

  return { valid: errors.length === 0, errors };
}
