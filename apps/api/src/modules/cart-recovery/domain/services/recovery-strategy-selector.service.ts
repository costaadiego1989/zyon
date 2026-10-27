import type { AbandonmentReason } from "../values/abandonment-reason.js";
import type { RecoveryStrategy } from "../values/recovery-strategy.js";

export interface StrategySelectionInput {
  session: {
    abandonmentScore: number;
  };
  buyerHistory: {
    known_buyer: boolean;
    discount_sensitivity: "high" | "medium" | "low";
    recent_skus: string[];
  };
  merchantRules: {
    allowFreeShipping: boolean;
    maxDiscountPercent: number;
  };
  abandonmentReason: AbandonmentReason;
}

const OBJECTION_TEMPLATES: Record<string, string> = {
  shipping_cost: "We understand shipping costs matter. Here are options...",
  price: "We noticed price is a concern. Let us help find a solution.",
  payment: "Payment issues are frustrating. Try alternative methods.",
  trust: "Your security is our priority. Here's how we protect you.",
  hesitation: "Take your time. We're here when you're ready.",
};

function getTemplate(reason: string): string {
  return OBJECTION_TEMPLATES[reason] ?? "We're here to help with your purchase.";
}

/**
 * Selects the best recovery strategy via 5-tier priority cascade.
 * Pure function — no I/O, no clock, no random.
 *
 * Priority order (lower ordinal wins):
 *   Tier 1: shipping_cost + allowFreeShipping → offer_free_shipping
 *   Tier 2: price + discount_sensitivity=high → escalate_discount (capped)
 *   Tier 3: known_buyer + score >= 0.5 → personalized_cross_sell
 *   Tier 4: specific objection (non-unknown) → address_objection
 *   Tier 5: score < 0.7 → wait_and_retry(60)
 *   Default: no_action
 */
export class RecoveryStrategySelector {
  static select(input: StrategySelectionInput): RecoveryStrategy {
    const { session, buyerHistory, merchantRules, abandonmentReason } = input;

    // Tier 1: shipping objection + merchant allows free shipping
    if (abandonmentReason === "shipping_cost" && merchantRules.allowFreeShipping) {
      return { type: "offer_free_shipping", condition: "merchant_allows_free_shipping" };
    }

    // Tier 2: price objection + high discount sensitivity
    if (abandonmentReason === "price" && buyerHistory.discount_sensitivity === "high") {
      const maxDiscount = merchantRules.maxDiscountPercent;
      return { type: "escalate_discount", value_percent: Math.min(maxDiscount, 10), cap: maxDiscount };
    }

    // Tier 3: returning customer + moderate score
    if (buyerHistory.known_buyer && session.abandonmentScore >= 0.5) {
      return {
        type: "personalized_cross_sell",
        suggested_skus: buyerHistory.recent_skus.slice(0, 3),
      };
    }

    // Tier 4: address specific objection (any non-unknown reason)
    if (abandonmentReason !== "unknown") {
      return {
        type: "address_objection",
        objection: abandonmentReason,
        response_template: getTemplate(abandonmentReason),
      };
    }

    // Tier 5: wait and retry (score not too high)
    if (session.abandonmentScore < 0.7) {
      return { type: "wait_and_retry", delay_minutes: 60 };
    }

    // Default: no action (too cold or too hot to be worth a strategy)
    return { type: "no_action", reason: "low_conversion_likelihood" };
  }
}
