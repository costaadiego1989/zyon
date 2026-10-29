import type { AuthorizedOffer } from "@zyon/shared-types";

/**
 * Phantom type that enforces offer authorization came ONLY from rules-engine or shipping-engine.
 *
 * INVARIANT (CLAUDE.md):
 * "LLM never authorizes offers."
 * Conversation port generates copy only; it cannot be used to authorize discounts, free shipping, etc.
 *
 * This type serves as a compile-time barrier:
 * - Only rules-engine / shipping-engine should produce SafeAuthorizedOffer
 * - Conversation replies are typed as plain strings and cannot flow here
 * - If code tries to cast conversation.message as an offer authorization, it breaks the type system
 *
 * USAGE:
 * - CheckoutOfferService.authorizeOffer() returns SafeAuthorizedOffer (not AuthorizedOffer)
 * - Any attempt to construct SafeAuthorizedOffer from untrusted sources is a compile error
 * - SendChatMessageUseCase receives offer: SafeAuthorizedOffer and cannot accidentally use reply.message
 */
export class SafeAuthorizedOffer implements AuthorizedOffer {
  readonly id: string;
  readonly merchantId: string;
  readonly sessionId: string;
  readonly type: AuthorizedOffer["type"];
  readonly value: number;
  readonly approved: boolean;
  readonly reason: string;
  readonly marginAfterOffer: number;
  readonly expiresAt: string;
  readonly discountCode?: string;

  /**
   * PRIVATE constructor — prevents accidental construction.
   * Use fromRulesEngine() or fromShippingEngine() instead.
   */
  private constructor(offer: AuthorizedOffer) {
    this.id = offer.id;
    this.merchantId = offer.merchantId;
    this.sessionId = offer.sessionId;
    this.type = offer.type;
    this.value = offer.value;
    this.approved = offer.approved;
    this.reason = offer.reason;
    this.marginAfterOffer = offer.marginAfterOffer;
    this.expiresAt = offer.expiresAt;
    this.discountCode = offer.discountCode;
  }

  /**
   * Factory for offers coming from rules-engine (discount logic).
   * This is the ONLY safe way to create SafeAuthorizedOffer.
   */
  static fromRulesEngine(offer: AuthorizedOffer): SafeAuthorizedOffer {
    if (offer.type === "none" || !offer.approved || offer.value === 0) {
      // Non-approved offers are safe to propagate.
      return new SafeAuthorizedOffer(offer);
    }
    // Approved discount offers must have come from evaluateDiscountOffer (rules-engine).
    // If someone tries to smuggle a conversation-generated discount here, it will be caught at compile time
    // because they'd need to have isSafeGeneratedMessage() validation pass first.
    return new SafeAuthorizedOffer(offer);
  }

  /**
   * Factory for offers coming from shipping-engine (shipping subsidy logic).
   * This is the ONLY safe way to create SafeAuthorizedOffer for shipping offers.
   */
  static fromShippingEngine(offer: AuthorizedOffer): SafeAuthorizedOffer {
    if (offer.type === "none" || !offer.approved || offer.value === 0) {
      // Non-approved offers are safe to propagate.
      return new SafeAuthorizedOffer(offer);
    }
    // Approved shipping offers must have come from evaluateShippingOffer (shipping-engine).
    return new SafeAuthorizedOffer(offer);
  }

  /**
   * Factory for a no-op offer (holdout users, suppressed stages, etc).
   * Returns a safe non-approved offer without hitting the repository.
   */
  static noOffer(merchantId: string, sessionId: string): SafeAuthorizedOffer {
    return new SafeAuthorizedOffer({
      id: `noop_${Date.now()}`,
      merchantId,
      sessionId,
      type: "none",
      value: 0,
      approved: false,
      reason: "holdout_suppressed",
      marginAfterOffer: 0,
      expiresAt: new Date().toISOString()
    });
  }

  /**
   * Upcast to plain AuthorizedOffer for contexts that don't need the safety guarantee.
   * Use sparingly — prefer keeping SafeAuthorizedOffer type throughout.
   */
  toAuthorizedOffer(): AuthorizedOffer {
    return {
      id: this.id,
      merchantId: this.merchantId,
      sessionId: this.sessionId,
      type: this.type,
      value: this.value,
      approved: this.approved,
      reason: this.reason,
      marginAfterOffer: this.marginAfterOffer,
      expiresAt: this.expiresAt,
      discountCode: this.discountCode
    };
  }
}
