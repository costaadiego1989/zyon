import { createHash } from "node:crypto";
import type { EmbedTokenClaims } from "./embed-token.service.js";

/** The signed token is a capability for exactly one checkout, not every buyer in its tenant. */
export function embedCheckoutSessionId(embed: EmbedTokenClaims): string {
  if (!embed.nonce || !embed.merchantId) throw new Error("embed_session_binding_missing");
  if (embed.recoveredCheckoutSessionId !== undefined) {
    if (typeof embed.recoveredCheckoutSessionId !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(embed.recoveredCheckoutSessionId)) throw new Error("embed_recovery_binding_invalid");
    return embed.recoveredCheckoutSessionId;
  }
  const digest = createHash("sha256").update(JSON.stringify([embed.merchantId, embed.nonce])).digest("hex");
  return `chk_embed_${digest}`;
}
