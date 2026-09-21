import { createHash, randomUUID } from "node:crypto";

export function voiceSessionReservationInput(input: { merchantId: string; conversationId: string; idempotencyKey?: unknown }) {
  const supplied = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const idempotencyKey = /^[A-Za-z0-9:_-]{16,160}$/.test(supplied) ? supplied : randomUUID();
  return {
    idempotencyKey,
    requestFingerprint: createHash("sha256")
      .update(`${input.merchantId}:${input.conversationId}:realtime-client-secret`)
      .digest("hex"),
  };
}
