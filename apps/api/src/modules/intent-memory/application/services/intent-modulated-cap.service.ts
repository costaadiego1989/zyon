import type { Cart, MerchantRules } from "@zyon/shared-types";

/**
 * Represents buyer intent snapshot needed for discount cap modulation.
 * Used in F1 — Intent Modulates Suggestion.
 */
export interface IntentSnapshot {
  primary_intent: string;
  urgency: "low" | "medium" | "high";
  budget_tier: "budget" | "mid" | "premium";
  pain_points: string[];
}

/**
 * IntentModulatedCapService (F1-T01)
 *
 * Pure service (no I/O, no NestJS) that resolves discount cap and shipping nudge
 * based on buyer intent and cart state.
 *
 * Design per ADI-F1-01..06:
 * - price_sensitive → tends toward maxDiscountPercent
 * - quality_seeker / ready_to_buy → tends toward minOffer (0)
 * - browsing / no intent → fallback to maxDiscountPercent
 * - Result always clamped [0, maxDiscountPercent]
 * - Shipping nudge: price_sensitive + cart >= 85% freeShippingMinCartValue
 */
export class IntentModulatedCapService {
  /**
   * Resolve discount cap based on intent and merchant rules.
   *
   * @param intent buyer intent snapshot (undefined = no intent/new buyer)
   * @param rules merchant rules (contains maxDiscountPercent cap)
   * @param minOffer minimum offer in percent (from other sources; typically 0)
   * @returns capped discount percent [0, maxDiscountPercent]
   *
   * ADI-F1-02: price_sensitive → max; quality_seeker/ready_to_buy → min
   * ADI-F1-04: clamp [0, maxDiscountPercent]
   * ADI-F1-06: no intent → max (fallback, no regression)
   */
  resolveDiscountCap(
    intent: IntentSnapshot | undefined,
    rules: MerchantRules,
    minOffer: number,
  ): number {
    // ADI-F1-06: fallback to max if no intent
    if (!intent || !intent.primary_intent) {
      return rules.maxDiscountPercent;
    }

    let cap: number;

    // ADI-F1-02: modulate based on primary_intent
    if (intent.primary_intent === "price_sensitive") {
      // price_sensitive → tend toward max
      cap = rules.maxDiscountPercent;
    } else if (
      intent.primary_intent === "quality_seeker" ||
      intent.primary_intent === "ready_to_buy"
    ) {
      // quality_seeker / ready_to_buy → tend toward min (zero discount)
      cap = 0;
    } else {
      // browsing or unknown intent → fallback to max
      cap = rules.maxDiscountPercent;
    }

    // ADI-F1-04: always clamp [0, maxDiscountPercent]
    return Math.max(0, Math.min(cap, rules.maxDiscountPercent));
  }

  /**
   * Resolve whether to nudge free shipping offer.
   *
   * @param intent buyer intent snapshot
   * @param cart current cart state
   * @param rules merchant rules (contains freeShippingMinCartValue)
   * @returns { nudge: boolean }
   *
   * ADI-F1-03: price_sensitive + cart >= 0.85 * freeShippingMinCartValue → nudge
   *            quality_seeker never nudges
   */
  resolveShippingNudge(
    intent: IntentSnapshot | undefined,
    cart: Cart,
    rules: MerchantRules,
  ): { nudge: boolean } {
    // No intent → no nudge
    if (!intent || !intent.primary_intent) {
      return { nudge: false };
    }

    // ADI-F1-03: only price_sensitive nudges
    if (intent.primary_intent !== "price_sensitive") {
      return { nudge: false };
    }

    // quality_seeker, ready_to_buy, browsing → never nudge
    // (already filtered out above)

    // ADI-F1-03: threshold = 85% of freeShippingMinCartValue
    const threshold = 0.85 * rules.freeShippingMinCartValue;
    const nudge = cart.total >= threshold;

    return { nudge };
  }
}
