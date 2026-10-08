/** Cumulative rounding returns every original cent when the last unit is returned. */
export function refundShippingCents(input: {
  originalCents: number; orderedQuantity: number; returnedQuantity: number;
  previouslyReturnedQuantity?: number; previouslyRefundedCents?: number;
}): number {
  const { originalCents, orderedQuantity, returnedQuantity } = input;
  const previousQuantity = input.previouslyReturnedQuantity ?? 0;
  const previousCents = input.previouslyRefundedCents ?? 0;
  if (![originalCents, orderedQuantity, returnedQuantity, previousQuantity, previousCents]
    .every(value => Number.isSafeInteger(value) && value >= 0) || orderedQuantity < 1 ||
    returnedQuantity < 1 || returnedQuantity + previousQuantity > orderedQuantity || previousCents > originalCents) {
    throw new Error("refund_shipping_identity_invalid");
  }
  const cumulative = Number(BigInt(originalCents) * BigInt(returnedQuantity + previousQuantity) / BigInt(orderedQuantity));
  return Math.max(0, cumulative - previousCents);
}
