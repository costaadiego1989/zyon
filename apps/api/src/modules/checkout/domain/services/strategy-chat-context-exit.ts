import type { CheckoutSession } from "@zyon/shared-types";
import type { SafeAuthorizedOffer } from "../types/safe-authorized-offer.js";

// Part of the reviewed baseline. Applies identically to control and treatment.
export const STRATEGY_CHAT_CONTEXT_EXIT_VERSION = "checkout-context-exit-v1" as const;
export const STRATEGY_CHAT_SUPPRESSION_RECOVERY_VERSION = "checkout-suppression-recovery-v1" as const;

/** Server-loaded context only. A change in eligibility ends further experimental
 * turns for this session; it never removes the original assignment or purchase. */
export function strategyChatContextExit(input: { session: CheckoutSession; offer: SafeAuthorizedOffer;
  hasBuyerIntent: boolean; hasPreSearchedProducts: boolean; cryptoEnabled?: boolean }) {
  if (input.hasBuyerIntent || (input.session as any).buyerIntent !== undefined) return "checkout_context_personalization";
  if (input.hasPreSearchedProducts) return "checkout_context_catalog";
  if (input.cryptoEnabled) return "checkout_context_crypto";
  if (input.offer.approved || input.offer.type !== "none" || input.offer.value !== 0 || input.offer.discountCode
    || input.offer.reason === "advanced_coupon_available") return "checkout_context_offer";
  if ((input.session.cart.currentDiscount ?? 0) !== 0 || input.session.cart.commercialNudge) return "checkout_context_incentive";
  if (input.session.paymentMethod || (input.session as any).paymentConfirmed) return "checkout_context_payment";
  return undefined;
}
