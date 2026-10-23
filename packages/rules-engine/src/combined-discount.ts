import type { Cart, MerchantRules } from "@zyon/shared-types";
import { cartAmountIssue, moneyCents } from "./incentive-margin.js";

export interface CombinedDiscountDecision {
  kind: "authorized" | "blocked" | "requires_review";
  cartDiscountCents: number;
  totalDiscountCents: number;
  promotionDiscountCents: number;
  originalSubtotalCents: number;
  remainingDiscountCents: number;
  limitReached: boolean;
  limitApplied: boolean;
  reason: string;
}

const cents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Exact floor using the configured number's decimal representation. This avoids
 * a binary rounding artifact turning e.g. 0.29% of 10000 cents into 28 cents. */
export function floorDiscountPercentageCents(base: number, percent: number): number {
  const [coefficient, exponent = "0"] = percent.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient!.split(".");
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(base) * BigInt(`${whole}${fraction}`);
  return Number(scale >= 0 ? numerator / (100n * 10n ** BigInt(scale)) : numerator * 10n ** BigInt(-scale) / 100n);
}

/** Pure merchandise-budget authorization, not authentication or stacking policy.
 * Caller must supply SERVER-derived provenance and preserve coupon/reservation,
 * shipping, payment and commercial non-combinability authorities separately.
 *
 * Prices/total already contain promotion savings. Count those savings once
 * against the ceiling; optional cost/margin never authorize or block a benefit.
 * Non-authorized decisions grant zero monetary amounts. */
export function evaluateCombinedDiscount(cart: Cart, rules: Pick<MerchantRules, "maxDiscountPercent"> & Partial<MerchantRules>, requestedCartDiscountCents: number): CombinedDiscountDecision {
  let originalSubtotalCents = 0, promotionDiscountCents = 0;
  const denied = (kind: "blocked" | "requires_review", reason: string): CombinedDiscountDecision => ({
    kind, cartDiscountCents: 0, totalDiscountCents: 0, promotionDiscountCents, originalSubtotalCents,
    remainingDiscountCents: 0, limitReached: false, limitApplied: false, reason,
  });
  if (!cart || typeof cart !== "object" || !rules || typeof rules !== "object") return denied("blocked", "economic_input_invalid");
  if (cart.currency !== "BRL") return denied("blocked", "incentive_currency_unsupported");
  if (!cents(requestedCartDiscountCents) || !Number.isFinite(rules.maxDiscountPercent)
    || rules.maxDiscountPercent < 0 || rules.maxDiscountPercent > 100) return denied("blocked", "economic_input_invalid");
  const amountIssue = cartAmountIssue(cart);
  if (amountIssue) return denied("blocked", amountIssue);
  const subtotal = moneyCents(cart.total);
  const existing = cart.currentDiscount === undefined ? 0 : moneyCents(cart.currentDiscount);
  if (subtotal === null || existing === null) return denied("blocked", "economic_input_invalid");
  originalSubtotalCents = subtotal;
  const context: unknown = cart.discountBudget;
  if (context !== undefined) {
    if (context === null || typeof context !== "object" || Array.isArray(context)) return denied("requires_review", "discount_budget_invalid");
    const value = context as Record<string, unknown>;
    if (Object.keys(value).length !== 3 || !Object.keys(value).every(key => ["version", "originalSubtotalCents", "promotionDiscountCents"].includes(key))
      || value.version !== 1 || !cents(value.originalSubtotalCents) || !cents(value.promotionDiscountCents)
      || value.promotionDiscountCents > value.originalSubtotalCents
      || BigInt(subtotal) + BigInt(value.promotionDiscountCents) !== BigInt(value.originalSubtotalCents)) {
      return denied("requires_review", "discount_budget_invalid");
    }
    originalSubtotalCents = value.originalSubtotalCents;
    promotionDiscountCents = value.promotionDiscountCents;
  }
  const ceiling = floorDiscountPercentageCents(originalSubtotalCents, rules.maxDiscountPercent);
  const observedSavings = BigInt(promotionDiscountCents) + BigInt(existing);
  if (observedSavings > BigInt(ceiling)) return denied("requires_review", "existing_discount_above_limit");
  if (rules.maxDiscountPercent === 0 && requestedCartDiscountCents > existing) return denied("blocked", "discount_disabled_by_merchant");
  const target = Math.max(existing, requestedCartDiscountCents);
  const cartDiscountCents = Math.min(target, ceiling - promotionDiscountCents);
  const totalDiscountCents = promotionDiscountCents + cartDiscountCents;
  const limitApplied = target > cartDiscountCents;
  const limitReached = ceiling > 0 && observedSavings === BigInt(ceiling) && requestedCartDiscountCents > existing;
  return { kind: "authorized", cartDiscountCents, totalDiscountCents, promotionDiscountCents, originalSubtotalCents,
    remainingDiscountCents: ceiling - totalDiscountCents, limitReached, limitApplied,
    reason: limitReached ? "discount_limit_reached" : limitApplied ? "capped_by_combined_discount_limit"
      : totalDiscountCents > 0 ? "discount_allowed" : "discount_not_requested" };
}

