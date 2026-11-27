import { createHmac, timingSafeEqual } from "node:crypto";
/** Svix's documented id.timestamp.RAW bytes contract, with a five-minute replay window. */
export function verifyFiscalSvix(raw: Buffer | undefined, headers: Record<string, unknown>, secret: string, now = Date.now()) {
  const id = headers["svix-id"], timestamp = headers["svix-timestamp"], signature = headers["svix-signature"];
  if (!raw?.length || raw.length > 1024 * 1024 || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id) || typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof signature !== "string" || signature.length > 1024 || !/^whsec_[a-zA-Z0-9+/]+={0,2}$/.test(secret)) return false;
  const key = Buffer.from(secret.slice(6), "base64"); if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(id + "." + timestamp + ".").update(raw).digest();
  return signature.split(" ").some(part => { const match = /^v1,([a-zA-Z0-9+/]{43}=)$/.exec(part); if (!match) return false; const received = Buffer.from(match[1]!, "base64"); return received.length === expected.length && timingSafeEqual(received, expected); });
}
