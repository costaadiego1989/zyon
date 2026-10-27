import { ForbiddenException } from "@nestjs/common";
import { isMarketplacePaymentResumeBinding } from "../../payment/domain/marketplace-payment-resume.js";
import type { AuthorizedMarketplacePaymentResume } from "../../payment/application/marketplace-payment-resume.service.js";
import { embedCheckoutSessionId } from "./embed-checkout-session.js";
import type { EmbedTokenClaims } from "./embed-token.service.js";

const identifier = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);

/** Additional purpose proof required even when an ordinary embed token is otherwise valid. */
export function authorizedEmbedPaymentResume(claims: EmbedTokenClaims | undefined, requestedIntentId?: unknown): AuthorizedMarketplacePaymentResume {
  if (!claims) throw new ForbiddenException("marketplace_payment_resume_unavailable");
  const now = Math.floor(Date.now() / 1000), binding = claims.paymentResume;
  let validOrigin = false;
  try {
    const origin = new URL(claims.allowedOrigin!);
    validOrigin = origin.origin === claims.allowedOrigin && ["https:", "http:"].includes(origin.protocol);
  } catch { /* Missing or malformed origin is never an action capability. */ }
  if (claims.typ !== "aacp_embed_v1" || !identifier(claims.merchantId) || !identifier(claims.nonce) ||
    !identifier(claims.storefrontCartRef) || claims.cartRef !== undefined || !validOrigin ||
    !["test", "live"].includes(claims.environment ?? "") || !Array.isArray(claims.scopes) || claims.scopes.length !== 2 ||
    !claims.scopes.includes("payment:intents:read") || !claims.scopes.includes("payment:intents:resume") ||
    !Number.isSafeInteger(claims.issuedAtUnix) || claims.issuedAtUnix > now || claims.issuedAtUnix + 86400 <= now ||
    !Number.isSafeInteger(claims.expiresAtUnix) || claims.expiresAtUnix <= now || claims.expiresAtUnix > now + 300 ||
    claims.expiresAtUnix > claims.issuedAtUnix + 86400 || !isMarketplacePaymentResumeBinding(binding) ||
    binding.sessionId !== embedCheckoutSessionId(claims) ||
    requestedIntentId !== undefined && (!identifier(requestedIntentId) || requestedIntentId !== binding.intentId)) {
    throw new ForbiddenException("marketplace_payment_resume_unavailable");
  }
  return { merchantId: claims.merchantId, sessionId: binding.sessionId, cartRef: claims.storefrontCartRef,
    binding, expiresAtUnix: claims.expiresAtUnix };
}
