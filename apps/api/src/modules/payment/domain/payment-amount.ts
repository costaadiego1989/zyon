export type PaymentAmountBreakdown = {
  version: 1;
  currency: string;
  cartFingerprint?: string;
  itemsSubtotalCents: number;
  discountCents: number;
  shippingCents: number;
  platformFeeCents: number;
  totalCents: number;
};

export function assertPaymentAmount(value: PaymentAmountBreakdown, amountCents: number, currency: string): void {
  const amounts = [value.itemsSubtotalCents, value.discountCents, value.shippingCents, value.platformFeeCents, value.totalCents];
  if (value.version !== 1 || value.currency !== currency || amounts.some(n => !Number.isSafeInteger(n) || n < 0) ||
    value.discountCents > value.itemsSubtotalCents || value.totalCents <= 0 ||
    value.totalCents !== value.itemsSubtotalCents - value.discountCents + value.shippingCents + value.platformFeeCents ||
    value.totalCents !== amountCents) throw new Error("payment_amount_breakdown_invalid");
}
