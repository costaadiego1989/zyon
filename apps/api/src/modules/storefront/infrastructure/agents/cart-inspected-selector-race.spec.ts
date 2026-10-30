import test from "node:test";
import assert from "node:assert/strict";
import { createCartTurnPolicy } from "../../domain/tools/cart-turn-policy.js";
import { createCartHandlers } from "../tool-handlers/cart.handlers.js";
import { selectStorefrontCartLine } from "../../domain/services/storefront-cart-line-identity.js";
import type { StorefrontCart, StorefrontCartLineSelector } from "../../domain/ports/storefront-cart.port.js";

const line = { productId: "product", variantId: "essential", sku: "QA-ESSENTIAL", name: "Kit Essencial", quantity: 1, unitPriceCents: 6000 };
const sibling = { ...line, productId: "physical", variantId: "physical", sku: "QA-PHYSICAL", name: "QA Físico R$3", unitPriceCents: 300 };
const emptyCart = (): StorefrontCart => ({ id: "row", merchantId: "merchant", sessionId: "cart", items: [sibling, line],
  total: 6300, discount: 0, couponCode: null, freeShipping: false, createdAt: new Date(0), updatedAt: new Date(0) });
const message = (quantity: number) => `Mude a quantidade do Kit Essencial no meu carrinho para ${quantity} unidades.`;
const changedSelection = {
  options: { selectedOptions: [{ groupId: "color", groupName: "Cor", itemId: "red", itemName: "Vermelho", priceModifierInCents: 0 }] },
  slot: { selectedServiceSlot: { slotId: "new-slot", date: "2026-11-01", startTime: "10:00", startsAt: "2026-11-01T13:00:00Z",
    endsAt: "2026-11-01T13:30:00Z", timeZone: "America/Sao_Paulo", durationMinutes: 30 } },
};

// Actual admission reader, turn policy, handler and canonical selector, with
// explicit persistence doubles. The interleaving is not PostgreSQL lock proof.
for (const change of ["options", "slot"] as const) for (const quantity of [0, 2]) {
  test(`the inspected empty selection survives a ${change} change before writer selection at target${quantity}`, async () => {
    const inspectedCart = emptyCart(); let latest = structuredClone(inspectedCart), mutations = 0;
    let writtenSelector: StorefrontCartLineSelector | undefined;
    const deps = {
      prisma: { storefrontCart: { findUnique: async () => ({ merchantId: "merchant", sessionId: "cart", items: structuredClone(inspectedCart.items) }) } },
      productRepo: { findById: async () => ({ id: "product", merchantId: "merchant", isActive: true, type: "physical", variants: [{ id: "essential", isActive: true }] }) },
      stockRepo: { getAvailableStock: async () => ({ quantity: 10, reserved: 0 }) },
      cartRepo: {
        getOrCreate: async () => structuredClone(inspectedCart),
        updateItemQuantity: async (_merchant: string, _cart: string, variant: string, target: number, selector?: StorefrontCartLineSelector) => {
          // Another valid cart operation replaces the old unique selection
          // after admission/handler reads and before the locked writer read.
          latest = { ...structuredClone(inspectedCart), items: [structuredClone(sibling), { ...structuredClone(line), ...changedSelection[change] }] };
          writtenSelector = selector;
          const index = selectStorefrontCartLine(latest.items, variant, selector);
          if (index === undefined) throw Error("cart_item_not_found");
          if (target === 0) latest.items.splice(index, 1); else latest.items[index]!.quantity = target;
          mutations++;
          return structuredClone(latest);
        },
      },
    };
    const handlers = createCartHandlers(deps as never, { merchantId: "merchant", sessionId: "cart" });
    const admitted = await handlers.inspectCartQuantity!({ cartId: "cart", itemReference: "kit essencial", quantity });
    assert.equal(admitted.status, "admitted"); if (admitted.status !== "admitted") assert.fail("fixture admission failed");
    const policy = createCartTurnPolicy(message(quantity), undefined, "cart", admitted.selection);
    const [tool] = policy.wrap([{ name: "update_cart_item", execute: async args => ({ ok: true, data: await handlers.updateCartItem(args as never) }) }]);
    await tool!.execute({ cartId: "cart", variantId: "essential", quantity });
    assert.deepEqual(writtenSelector, { optionItemIds: [], serviceSlotId: null });
    assert.equal(mutations, 0, "the new options/slot line was never admitted by this turn");
    assert.deepEqual(latest.items, [sibling, { ...line, ...changedSelection[change] }]);
    assert.equal(policy.mutationOutcome?.status, "unknown", "a writer rejection does not imply an acknowledged prior mutation");
  });
}

test("materializing an empty selector does not grant a mismatched quantity, cart or variant", async () => {
  const selection = { cartId: "cart", variantId: "essential", quantity: 0, optionItemIds: [], serviceSlotId: null };
  for (const changed of [{ cartId: "foreign" }, { variantId: "physical" }, { quantity: 2 },
    { optionItemIds: ["red"] }, { serviceSlotId: "new-slot" }]) {
    const policy = createCartTurnPolicy(message(0), undefined, "cart", selection);
    const [tool] = policy.wrap([{ name: "update_cart_item", execute: async () => assert.fail("mismatched selection cannot reach the handler") }]);
    const result = await tool!.execute({ cartId: "cart", variantId: "essential", quantity: 0, ...changed });
    assert.equal(result.ok, false);
  }
});
