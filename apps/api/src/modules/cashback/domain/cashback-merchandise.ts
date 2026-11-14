import type { Cart } from "@zyon/shared-types";
import { CashbackError, cents } from "./cashback.js";

/** Prices already include promotions. Their server-authored original basis
 * counts those savings once against the combined cap, never as another charge. */
export function cashbackMerchandiseBasis(cart: Cart): { grossCents: number; promotionDiscountCents: number; netProductsCents: number } {
  const subtotal = cents(cart.items.reduce((sum, line) => sum + cents(Math.round(line.price * 100)) * line.quantity, 0));
  const explicit = cents(Math.round((cart.currentDiscount ?? 0) * 100));
  const budget = cart.discountBudget;
  if (!budget) return { grossCents: subtotal, promotionDiscountCents: 0, netProductsCents: Math.max(0, subtotal - explicit) };
  if (budget.version !== 1 || !Number.isSafeInteger(budget.originalSubtotalCents) || !Number.isSafeInteger(budget.promotionDiscountCents)
    || budget.originalSubtotalCents < 0 || budget.promotionDiscountCents < 0
    || budget.promotionDiscountCents > budget.originalSubtotalCents
    || BigInt(subtotal) + BigInt(budget.promotionDiscountCents) !== BigInt(budget.originalSubtotalCents)
    || Math.round(cart.total * 100) !== subtotal) throw new CashbackError("cashback_commercial_totals_invalid", 409);
  return { grossCents: cents(budget.originalSubtotalCents), promotionDiscountCents: cents(budget.promotionDiscountCents),
    netProductsCents: Math.max(0, subtotal - explicit) };
}
