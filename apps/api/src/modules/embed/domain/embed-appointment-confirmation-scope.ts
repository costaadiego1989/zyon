import { ForbiddenException } from "@nestjs/common";
import type { EmbedTokenClaims } from "./embed-token.service.js";
import { embedCheckoutSessionId } from "./embed-checkout-session.js";

/** Claims come from the existing signature/origin guard. No body identity may
 * widen this capability; expiration is checked again after transaction locks. */
export function embedAppointmentConfirmationScope(claims: EmbedTokenClaims) {
  if (!claims.scopes?.includes("appointments:confirm") || claims.nonce === "dev_bypass")
    throw new ForbiddenException("embed_service_confirmation_scope_required");
  if (!claims.merchantId?.trim() || !claims.allowedOrigin?.trim()
    || !Number.isSafeInteger(claims.expiresAtUnix) || claims.expiresAtUnix <= 0)
    throw new ForbiddenException("embed_service_confirmation_capability_invalid");
  return Object.freeze({ merchantId: claims.merchantId, sessionId: embedCheckoutSessionId(claims),
    expiresAtUnix: claims.expiresAtUnix, allowedOrigin: claims.allowedOrigin, scope: "appointments:confirm" as const });
}
