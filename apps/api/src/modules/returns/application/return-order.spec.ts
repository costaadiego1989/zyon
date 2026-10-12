import test from "node:test";
import assert from "node:assert/strict";
import { calculateReturnAmount, normalizeOrderItems, validateReturnItems } from "./return-order.service.js";
import { validateReturnPhoto } from "./return-attachment.service.js";
import type { SupportOrder } from "@zyon/shared-types";

const order: SupportOrder = { merchantId: "merchant", orderId: "order", completedAt: "2026-10-03T00:00:00.000Z", currency: "BRL", totalCents: 2900, shippingCents: 300, paymentStatus: "approved", items: normalizeOrderItems([{ variantId: "a", name: "Item A", unitPriceCents: 1000, quantity: 2 }, { variantId: "b", name: "Item B", unitPriceCents: 1000, quantity: 1 }]) };
test("historical major amounts normalize to cents; invalid lines never disappear into a full refund", () => {
  assert.equal(normalizeOrderItems([{ sku: "a", title: "A", unit_price: 10.99, quantity: 2 }])[0]?.unitPriceCents, 1099);
  assert.throws(() => normalizeOrderItems([{ variantId: "a", quantity: 1, unitPriceCents: 1000 }, { variantId: "b", quantity: 1 }]), /order_items_unavailable/);
  assert.throws(() => normalizeOrderItems([{ variantId: "a", quantity: 1, unitPriceCents: 1000 }, { variantId: "a", quantity: 1, unitPriceCents: 2000 }]), /ambiguous_order_item_price/);
});
test("return selection requires actual distinct items and bounded integer quantities", () => {
  for (const invalid of [[], [{ variantId: "all", quantity: 1 }], [{ variantId: "a", quantity: 3 }], [{ variantId: "a", quantity: 0 }], [{ variantId: "a", quantity: 1.5 }], [{ variantId: "a", quantity: 1 }, { variantId: "a", quantity: 1 }]]) assert.throws(() => validateReturnItems(order, invalid));
  assert.equal(validateReturnItems(order, [{ variantId: "a", quantity: 1 }])[0]?.quantity, 1);
});
test("partial refunds allocate historical discounts and shipping without consuming other items", () => {
  const selected = validateReturnItems(order, [{ variantId: "a", quantity: 1 }]);
  assert.equal(calculateReturnAmount(order, selected, 2900, 0), 966);
  assert.throws(() => calculateReturnAmount(order, selected, 2900, 2600), /refund_exceeds_available_balance/);
  assert.throws(() => calculateReturnAmount(order, selected, 2900, -1), /no_refundable_balance/);
});
test("final remaining units return the remaining captured balance including rounding and buyer fees", () => {
  const remaining = { ...order, items: order.items.map(item => ({ ...item, eligibleQuantity: item.variantId === "a" ? 1 : 0 })) };
  assert.equal(calculateReturnAmount(remaining, validateReturnItems(remaining, [{ variantId: "a", quantity: 1 }]), 3089, 2000), 1089);
});
test("return photos reject disguised files and oversized evidence before storage", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";
  assert.equal(validateReturnPhoto(png).contentType, "image/png");
  assert.throws(() => validateReturnPhoto("data:image/png;base64," + Buffer.from("not a PNG").toString("base64")), /invalid_photo_content/);
  assert.throws(() => validateReturnPhoto("data:image/svg+xml;base64,PHN2Zy8+"), /invalid_photo_type/);
  assert.throws(() => validateReturnPhoto("data:image/jpeg;base64," + Buffer.alloc(2_000_001).toString("base64")), /photo_too_large/);
});
