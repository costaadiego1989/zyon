import { createHmac, timingSafeEqual } from "node:crypto";
/** One raw-body primitive shared by fiscal and the existing configured inventory receiver. */
export function verifyBlingWebhookSignature(rawBody: Uint8Array | undefined, signature: unknown, secret: string): boolean {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength < 1 || rawBody.byteLength > 1024 * 1024 || typeof signature !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
    || !secret || secret.length > 4096 || /[\r\n]/.test(secret)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest(); const actual = Buffer.from(signature.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
