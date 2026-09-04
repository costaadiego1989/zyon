import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * M7: Algorithm support for password hashing with migration path.
 * Current: scrypt. Future: argon2id.
 * On verify, if a weaker algorithm is detected, the password can be rehashed
 * and persisted with the stronger algorithm (handled by the use-case/repository).
 */
type PasswordAlgorithm = "scrypt" | "argon2id";

/**
 * Password hasher with algorithm support and rehash-on-verify capability.
 * Returns both the hash and a flag indicating if rehashing is recommended.
 */
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt:${salt}:${key.toString("base64url")}`;
  }

  /**
   * Verify password against hash.
   * Returns { valid, shouldRehash }.
   * shouldRehash = true when the hash uses a weaker algorithm than current default.
   */
  async verify(password: string, hash: string): Promise<{ valid: boolean; shouldRehash: boolean }> {
    const parts = hash.split(":");
    if (parts.length !== 3) return { valid: false, shouldRehash: false };
    const [algorithm, salt, stored] = parts;

    // M7: Parse algorithm. Currently only scrypt is supported.
    if (algorithm !== "scrypt") {
      // Unknown algorithm — cannot verify
      return { valid: false, shouldRehash: false };
    }

    if (!salt || !stored) return { valid: false, shouldRehash: false };

    const expected = Buffer.from(stored, "base64url");
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual);

    // Scrypt is the current default; no rehash needed.
    return { valid, shouldRehash: false };
  }
}
