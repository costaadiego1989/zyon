import { createHash } from "node:crypto";
import type { SaleCompletedEvent } from "./sale-completed.event.js";

export function validateInventorySale(event: SaleCompletedEvent): SaleCompletedEvent {
  if (!event || !validId(event.merchantId) || !validId(event.orderId) || !Array.isArray(event.items) ||
    !event.items.length || event.items.length > 1000 || !Number.isSafeInteger(event.totalCents) || event.totalCents < 0 ||
    typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) throw new Error("inventory_sale_invalid");
  const items = new Map<string, SaleCompletedEvent["items"][number]>();
  for (const item of event.items) {
    if (!item || !validId(item.sku) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      (item.locationId !== undefined && !validId(item.locationId)) || (item.variantId !== undefined && !validId(item.variantId))) throw new Error("inventory_sale_item_invalid");
    const key = JSON.stringify([item.sku, item.locationId ?? null, item.variantId ?? null]);
    const quantity = (items.get(key)?.quantity ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > 2147483647) throw new Error("inventory_sale_quantity_invalid");
    items.set(key, { sku: item.sku, quantity, ...(item.variantId ? { variantId: item.variantId } : {}), ...(item.locationId ? { locationId: item.locationId } : {}) });
  }
  return { merchantId: event.merchantId, orderId: event.orderId, items: [...items.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item),
    totalCents: event.totalCents, timestamp: new Date(event.timestamp).toISOString(),
    ...(event.buyerEmail ? { buyerEmail: event.buyerEmail } : {}), ...(event.buyerName ? { buyerName: event.buyerName } : {}), ...(event.buyerPhone ? { buyerPhone: event.buyerPhone } : {}) };
}
export function inventorySaleFingerprint(event: SaleCompletedEvent): string {
  // Buyer profile enrichment and redelivery timestamps must not authorize a second debit.
  return createHash("sha256").update(JSON.stringify({ merchantId: event.merchantId, orderId: event.orderId, items: event.items, totalCents: event.totalCents })).digest("hex");
}
export function inventorySaleId(merchantId: string, orderId: string): string {
  return `inv_sale_${createHash("sha256").update(JSON.stringify([merchantId, orderId])).digest("hex")}`;
}
export function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 512; }
