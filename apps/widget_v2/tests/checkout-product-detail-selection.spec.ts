import test from "node:test";
import assert from "node:assert/strict";
import { selectCheckoutProductDetail } from "../../storefront/src/lib/checkout-product-detail.js";
const request = { initialVariantId: "blue", initialSku: "BLUE" };
function purchase() { return { productName: "Synthetic", defaultVariantId: "blue", images: [],
  variants: [{ id: "blue", sku: "BLUE", available: true, currency: "BRL", attributes: {}, priceReais: 10, lowStock: false },
    { id: "red", sku: "RED", available: true, currency: "BRL", attributes: {}, priceReais: 12, lowStock: false }],
  optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single" as const, items: [{ id: "large", name: "Grande", priceModifierInCents: 500 }] }] }; }
test("missing required option remains incomplete without preparing or accepting an arbitrary default", () => {
  assert.deepEqual(selectCheckoutProductDetail(request, purchase(), "blue", []), { kind: "incomplete" });
});
test("selected variant carries its own canonical SKU/options, never the recommendation SKU for another variant", () => {
  assert.deepEqual(selectCheckoutProductDetail(request, purchase(), "red", ["large"]), { kind: "selected", selection: { variantId: "red", sku: "RED", quantity: 1, selectedOptionItemIds: ["large"] } });
});
for (const kind of ["missing SKU", "unavailable", "foreign currency", "unknown option", "duplicate option", "missing recommended variant", "changed recommended SKU", "malformed options"] as const)
  test(`invalid checkout detail ${kind} cannot fall back to a regular product addition`, () => {
    const data = purchase(); if (kind === "missing SKU") data.variants[1]!.sku = "";
    if (kind === "unavailable") data.variants[1]!.available = false;
    if (kind === "foreign currency") data.variants[1]!.currency = "USD";
    if (kind === "missing recommended variant") data.variants.shift();
    if (kind === "changed recommended SKU") data.variants[0]!.sku = "OTHER";
    if (kind === "malformed options") Object.assign(data.optionGroups[0]!, { items: null });
    const ids = kind === "unknown option" ? ["unknown"] : kind === "duplicate option" ? ["large", "large"] : ["large"];
    assert.deepEqual(selectCheckoutProductDetail(request, data, "red", ids), { kind: "unavailable" });
  });
