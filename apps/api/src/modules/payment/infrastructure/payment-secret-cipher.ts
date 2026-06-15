import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { isProduction } from "../../../shared/config/secret-config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const SALT = "aacp-payment-connection";
const DEV_KEY = "aacp-dev-payment-connection-key";

function keyFrom(env: NodeJS.ProcessEnv): Buffer {
  const material = env.AACP_PAYMENT_ENC_KEY?.trim();
  if (!material) {
    if (isProduction(env.NODE_ENV)) {
      throw new Error("missing_required_secret:AACP_PAYMENT_ENC_KEY");
    }
    return scryptSync(DEV_KEY, SALT, 32);
  }
  return scryptSync(material, SALT, 32);
}

export function encryptPaymentSecret(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(env), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptPaymentSecret(
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const [iv, tag, ciphertext] = payload.split(":");
  if (!iv || !tag || !ciphertext) {
    throw new Error("payment_secret_cipher_malformed");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    keyFrom(env),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
