import { encryptPii, decryptPii, isPiiEncrypted } from "../../../../shared/crypto/pii-cipher.service.js";

// Keep routing identifiers queryable. Only secret values are encrypted; legacy
// plaintext rows remain readable and are upgraded on their next credential write.
export function encodeWhatsAppCredentials(value: Record<string, unknown>) {
  const result = { ...value };
  for (const key of ["authToken", "metaAccessToken", "accessToken"]) {
    const secret = result[key];
    if (typeof secret === "string" && secret && !isPiiEncrypted(secret)) result[key] = encryptPii(secret);
  }
  return result;
}
export function decodeWhatsAppCredentials(value: Record<string, unknown>) {
  const result = { ...value };
  for (const key of ["authToken", "metaAccessToken", "accessToken"]) {
    const secret = result[key];
    if (typeof secret === "string" && isPiiEncrypted(secret)) result[key] = decryptPii(secret);
  }
  return result;
}
