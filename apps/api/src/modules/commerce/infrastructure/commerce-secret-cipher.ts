import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { isProduction } from "../../../shared/config/secret-config.js";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const SALT = "aacp-commerce-token";
const DEV_KEY_MATERIAL = "aacp-dev-commerce-cipher-key";

function deriveKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const material = env.AACP_COMMERCE_ENC_KEY?.trim();
  if (!material) {
    if (isProduction(env.NODE_ENV)) {
      throw new Error("missing_required_secret:AACP_COMMERCE_ENC_KEY");
    }
    return scryptSync(DEV_KEY_MATERIAL, SALT, 32);
  }
  return scryptSync(material, SALT, 32);
}

/** Encrypts a Shopify admin token for at-rest storage. Output: iv:tag:ciphertext (base64). */
export function encryptCommerceSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = deriveKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptCommerceSecret(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("commerce_secret_cipher_malformed");
  }
  const key = deriveKey(env);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
