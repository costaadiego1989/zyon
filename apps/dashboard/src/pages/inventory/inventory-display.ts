export function signedMovementQuantity(kind: string, quantity: number): number {
  if (quantity < 0) return quantity;
  return ["ENTRY", "TRANSFER_IN", "RELEASE", "ADJUSTMENT", "ADJUSTMENT_POSITIVE", "RETURN"].includes(kind) ? quantity : -quantity;
}

export function formatMovementQuantity(kind: string, quantity: number): string {
  const signed = signedMovementQuantity(kind, quantity);
  return `${signed >= 0 ? "+" : "−"}${Math.abs(signed)}`;
}

export function inventoryAdjustment(value: string): number | null {
  const trimmed = value.trim();
  const delta = Number(trimmed);
  return /^[+-]?\d+$/.test(trimmed) && Number.isSafeInteger(delta) && delta !== 0 && Math.abs(delta) <= 2_147_483_647 ? delta : null;
}
