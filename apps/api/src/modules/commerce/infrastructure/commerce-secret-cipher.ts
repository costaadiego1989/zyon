import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { isProduction } from "../../../shared/config/secret-config.js";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const SALT_BYTES = 16;
const DEV_KEY_MATERIAL = "aacp-dev-commerce-cipher-key";
// Legacy fixed salt (pre-random-salt cipher). Kept only for decrypting tokens
// stored before the salt-per-secret upgrade. New encryptions never use it.
const LEGACY_FIXED_SALT = "aacp-commerce-token";

function keyMaterial(env: NodeJS.ProcessEnv = process.env): string {
  const material = env.AACP_COMMERCE_ENC_KEY?.trim();
  if (!material) {
    if (isProduction(env.NODE_ENV)) {
      throw new Error("missing_required_secret:AACP_COMMERCE_ENC_KEY");
    }
    return DEV_KEY_MATERIAL;
  }
  return material;
}

/** Derives a 32-byte key from the base material and a per-secret random salt. */
function deriveKey(material: string, salt: Buffer): Buffer {
  return scryptSync(material, salt, 32);
}

/**
 * Encrypts a commerce admin token for at-rest storage.
 * A random salt is generated per encryption and prepended to the output so
 * each ciphertext derives a unique key — defeating precomputation/rainbow attacks.
 * Output: salt:iv:tag:ciphertext (base64).
 */
export function encryptCommerceSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const material = keyMaterial(env);
  const salt = randomBytes(SALT_BYTES);
  const key = deriveKey(material, salt);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
}

export function decryptCommerceSecret(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  const parts = payload.split(":");

  // New format (4 segments): salt:iv:tag:ciphertext (random salt per secret)
  if (parts.length === 4) {
    const [saltB64, ivB64, tagB64, dataB64] = parts;
    if (!saltB64 || !ivB64 || !tagB64 || !dataB64) {
      throw new Error("commerce_secret_cipher_malformed");
    }
    const material = keyMaterial(env);
    const key = deriveKey(material, Buffer.from(saltB64, "base64"));
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  // Legacy format (3 segments): iv:tag:ciphertext (fixed salt "aacp-commerce-token")
  if (parts.length === 3) {
    const [ivB64, tagB64, dataB64] = parts;
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error("commerce_secret_cipher_malformed");
    }
    const material = keyMaterial(env);
    const key = deriveKey(material, Buffer.from(LEGACY_FIXED_SALT, "utf8"));
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  throw new Error("commerce_secret_cipher_malformed");
}
