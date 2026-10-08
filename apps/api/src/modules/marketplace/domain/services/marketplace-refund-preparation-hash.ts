import { createHash } from "node:crypto";

export interface MarketplaceRefundPreparationSnapshot {
  hostMerchantId: string;
  paymentIntentId: string;
  returnId: string;
  orderId: string;
  status: string;
  items: Array<{ variantId: string; quantity: number }>;
  identities: Array<{ lineItemId: string; variantId: string; quantity: number }>;
  instructionsHash: string;
  budgetHash: string;
  previous: Array<{ id: string; allocationHash: string; status: string }>;
}

/** Instructions/budget commit seller identities, prices, capture and original freight/fees;
 * previous allocations commit the quantities and components already refunded. */
export function marketplaceRefundPreparationHash(input: MarketplaceRefundPreparationSnapshot): string {
  const compare = (a: unknown, b: unknown) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const value = ["marketplace-refund-preparation-v1", input.hostMerchantId, input.paymentIntentId, input.returnId,
    input.orderId, input.status, input.instructionsHash, input.budgetHash,
    input.items.map(row => [row.variantId, row.quantity]).sort((a, b) => compare(a[0], b[0])),
    input.identities.map(row => [row.lineItemId, row.variantId, row.quantity]).sort((a, b) => compare(a[0], b[0])),
    input.previous.map(row => [row.id, row.allocationHash, row.status]).sort((a, b) => compare(a[0], b[0]))];
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
