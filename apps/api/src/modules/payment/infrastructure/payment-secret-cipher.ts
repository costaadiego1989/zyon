import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { isProduction } from "../../../shared/config/secret-config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const SALT_BYTES = 16;
const LEGACY_SALT = "aacp-payment-connection";
const DEV_KEY = "aacp-dev-payment-connection-key";
const CURRENT_VERSION = "v2";

function keyFrom(env: NodeJS.ProcessEnv, salt: Buffer | string): Buffer {
  const material = env.AACP_PAYMENT_ENC_KEY?.trim();
  if (!material) {
    if (isProduction(env.NODE_ENV)) {
      throw new Error("missing_required_secret:AACP_PAYMENT_ENC_KEY");
    }
    return scryptSync(DEV_KEY, salt, 32);
  }
  return scryptSync(material, salt, 32);
}

/**
 * H4 fix: encrypt with per-secret random salt and version prefix.
 * Format: v2:{salt}:{iv}:{tag}:{ciphertext}  (all base64)
 */
export function encryptPaymentSecret(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(env, salt), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    CURRENT_VERSION,
    salt.toString("base64"),
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * H4 fix: decrypt supports both v2 (per-secret salt) and legacy v1 (fixed salt) formats.
 * v2 format: v2:{salt}:{iv}:{tag}:{ciphertext}
 * legacy format: {iv}:{tag}:{ciphertext} (fixed SALT)
 */
export function decryptPaymentSecret(
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const parts = payload.split(":");

  if (parts[0] === CURRENT_VERSION) {
    // v2: per-secret salt
    const [, saltB64, ivB64, tagB64, ciphertextB64] = parts;
    if (!saltB64 || !ivB64 || !tagB64 || !ciphertextB64) {
      throw new Error("payment_secret_cipher_malformed_v2");
    }
    const salt = Buffer.from(saltB64, "base64");
    const decipher = createDecipheriv(
      ALGORITHM,
      keyFrom(env, salt),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  // Legacy v1: fixed SALT, no version prefix
  const [iv, tag, ciphertext] = parts;
  if (!iv || !tag || !ciphertext) {
    throw new Error("payment_secret_cipher_malformed");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    keyFrom(env, LEGACY_SALT),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
