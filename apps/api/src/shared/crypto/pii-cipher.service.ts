import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { isProduction } from "../config/secret-config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const SALT_BYTES = 16;
const VERSION = "pii_v1";
const DEV_KEY = "aacp-dev-pii-cipher-key";

function keyFrom(env: NodeJS.ProcessEnv, salt: Buffer): Buffer {
  const material = env.AACP_PII_ENC_KEY?.trim();
  if (!material) {
    if (isProduction(env.NODE_ENV)) {
      throw new Error("missing_required_secret:AACP_PII_ENC_KEY");
    }
    return scryptSync(DEV_KEY, salt, 32);
  }
  return scryptSync(material, salt, 32);
}

export function encryptPii(
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
    VERSION,
    salt.toString("base64"),
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptPii(
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const [version, saltB64, ivB64, tagB64, ciphertextB64] = payload.split(":");
  if (version !== VERSION) throw new Error("pii_cipher_unsupported_version");
  if (!saltB64 || !ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("pii_cipher_malformed");
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

export function isPiiEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}
