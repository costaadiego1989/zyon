import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCartHandlers } from "../../../storefront/infrastructure/tool-handlers/cart.handlers.js";

describe("storefront handler quantity authority", () => {
  function fixture(existingQuantities: number[], available: number, type = "physical") {
    let writes = 0;
    const product = { id: "product", name: "QA", type, metadata: {}, isActive: true, variants: [{ id: "blue", sku: "SKU-BLUE", isActive: true, attributes: {}, basePriceInCents: 1700, media: [] }] };
    const cart = { id: "cart", sessionId: "session", items: existingQuantities.map((quantity, i) => ({ variantId: "blue", productId: "product", sku: "SKU-BLUE", quantity, selectedOptions: [{ itemId: `option-${i}` }] })) };
    const handlers = createCartHandlers({
      prisma: { productVariant: { findFirst: async () => ({ productId: "product" }) } },
      productRepo: { findById: async () => product, search: async () => ({ products: [product], total: 1 }) },
      stockRepo: { getAvailableStock: async () => ({ quantity: available, reserved: 0 }) },
      cartRepo: { getOrCreate: async () => cart, addItem: async () => { writes++; return cart; }, updateItemQuantity: async () => { writes++; return cart; } },
    } as any, { merchantId: "merchant", sessionId: "session" } as any);
    return { handlers, writes: () => writes };
  }
  it("rejects an addition when existing native quantity already consumes the variant balance", async () => {
    const f = fixture([1], 1);
    assert.equal((await f.handlers.addItemToCart({ variantId: "blue", quantity: 1 }) as any).error, "variant_out_of_stock");
    assert.equal(f.writes(), 0);
  });
  it("aggregates different food option lines before adding another quantity", async () => {
    const f = fixture([1, 1], 2, "food");
    assert.equal((await f.handlers.addItemToCart({ variantId: "blue", quantity: 1 }) as any).error, "variant_out_of_stock"); assert.equal(f.writes(), 0);
  });
  it("rejects an above-balance quantity update and ambiguous option-line update", async () => {
    const f = fixture([1], 1);
    assert.equal((await f.handlers.updateCartItem({ cartId: "cart", variantId: "blue", quantity: 2 }) as any).error, "variant_out_of_stock"); assert.equal(f.writes(), 0);
    const ambiguous = fixture([1, 1], 5, "food");
    assert.equal((await ambiguous.handlers.updateCartItem({ cartId: "cart", variantId: "blue", quantity: 2 }) as any).error, "cart_option_line_selection_required"); assert.equal(ambiguous.writes(), 0);
  });
});
