/**
 * Domain-level input validators for the auth module.
 * Closes H5: assertValidEmail / assertStrongPassword.
 */

import { InvalidEmailError, WeakPasswordError } from "./errors.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function assertValidEmail(email: string): void {
  const trimmed = email.trim();
  if (!trimmed || !EMAIL_REGEX.test(trimmed)) {
    throw new InvalidEmailError(trimmed);
  }
}

export function assertStrongPassword(password: string): void {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`min_length_${MIN_PASSWORD_LENGTH}`);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
