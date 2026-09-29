import { createHash } from "node:crypto";

export type PaymentAmountBreakdown = {
  version: 1;
  currency: string;
  cartFingerprint?: string;
  /** Buyer explicitly confirmed the revised checkout after an expired benefit. */
  confirmedCartFingerprint?: string;
  itemsSubtotalCents: number;
  discountCents: number;
  shippingCents: number;
  platformFeeCents: number;
  totalCents: number;
};

/** A checkout revision binds the exact total, including the buyer service fee.
 * It excludes the confirmation itself and is opaque to checkout clients. */
export function paymentReviewFingerprint(value: PaymentAmountBreakdown): string {
  return createHash("sha256").update(JSON.stringify(["checkout-payment-review-v1", value.cartFingerprint,
    value.currency, value.itemsSubtotalCents, value.discountCents, value.shippingCents,
    value.platformFeeCents, value.totalCents])).digest("hex");
}

export function assertPaymentAmount(value: PaymentAmountBreakdown, amountCents: number, currency: string): void {
  const amounts = [value.itemsSubtotalCents, value.discountCents, value.shippingCents, value.platformFeeCents, value.totalCents];
  if (value.version !== 1 || value.currency !== currency || amounts.some(n => !Number.isSafeInteger(n) || n < 0) ||
    value.discountCents > value.itemsSubtotalCents || value.totalCents <= 0 ||
    value.totalCents !== value.itemsSubtotalCents - value.discountCents + value.shippingCents + value.platformFeeCents ||
    value.totalCents !== amountCents) throw new Error("payment_amount_breakdown_invalid");
}

/** Amount belonging to the merchant order, excluding the buyer service fee. */
export function orderTotalCents(
  input: Pick<PaymentAmountBreakdown, "itemsSubtotalCents" | "discountCents" | "shippingCents"> | undefined,
  fallbackCents: number,
): number {
  if (!input) return fallbackCents;
  const total = input.itemsSubtotalCents - input.discountCents + input.shippingCents;
  return Number.isSafeInteger(total) && total >= 0 ? total : fallbackCents;
}
