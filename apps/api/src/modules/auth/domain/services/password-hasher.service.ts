import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt:${salt}:${key.toString("base64url")}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const [algorithm, salt, stored] = hash.split(":");
    if (algorithm !== "scrypt" || !salt || !stored) return false;
    const expected = Buffer.from(stored, "base64url");
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
