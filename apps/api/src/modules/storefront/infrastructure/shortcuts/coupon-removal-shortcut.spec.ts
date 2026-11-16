import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeterministicShortcut, type DeterministicShortcutDeps } from "./deterministic-shortcuts.service.js";
import { createCartHandlers } from "../tool-handlers/cart.handlers.js";
import { STOREFRONT_CONTRACT_FALLBACK } from "../../domain/contracts/storefront-conversation.schemas.js";
import type { StorefrontConversationInput } from "../../domain/ports/conversation.port.js";
import type { ConversationBlock } from "../../domain/types/conversation-block.js";

const input = (userMessage: string): StorefrontConversationInput => ({ merchantId: "owned-merchant", sessionId: "owned-conversation", cartId: "owned-cart", userMessage, history: [], storeCategory: "others" });
function fixture() {
  let writes = 0;
  const state = { id: "row", merchantId: "owned-merchant", sessionId: "owned-cart", items: [{ variantId: "owned-variant", productId: "owned-product", name: "Produto", sku: "OWNED", quantity: 2, unitPriceCents: 2500 }], total: 5000, discount: 500, couponCode: "OWNEDCOUPON" as string | null, freeShipping: false, createdAt: new Date(), updatedAt: new Date() };
  const handlers = createCartHandlers({ cartRepo: { removeCoupon: async (merchantId: string, cartId: string) => {
    assert.equal(merchantId, "owned-merchant"); assert.equal(cartId, "owned-cart"); writes++; state.couponCode = null; state.discount = 0; return structuredClone(state);
  } } } as never, { merchantId: "owned-merchant", sessionId: "owned-cart" });
  const deps: DeterministicShortcutDeps = {
    productRepo: { search: async () => assert.fail("coupon removal must not search products") } as never,
    copyService: {} as never, emitFunnelEvent: async () => assert.fail("coupon removal must not create funnel events"),
    removeCoupon: args => handlers.removeCoupon(args),
    getCartBlock: async cartId => ({ type: "cart_summary", data: { cartId, items: state.items.map(item => ({ variantId: item.variantId, productName: item.name, quantity: item.quantity, price: item.unitPriceCents / 100, subtotal: item.quantity * item.unitPriceCents / 100 })), itemCount: 2, subtotal: 50, discount: state.discount / 100, total: (state.total - state.discount) / 100 } }) as ConversationBlock,
  };
  return { state, deps, writes: () => writes };
}
for (const phrase of ["Remova o cupom E2EATHOM1116FFIX do meu carrinho e mantenha os produtos.", "Retirar cupom do carrinho", "Remover cupom"]) {
  test(`explicit coupon removal: ${phrase}`, async () => {
    const f = fixture(), original = structuredClone(f.state.items);
    const result = await resolveDeterministicShortcut(f.deps, input(phrase));
    assert.ok(result); assert.match(result.message, /Cupom removido/); assert.equal(f.writes(), 1);
    assert.equal(f.state.couponCode, null); assert.equal(f.state.discount, 0); assert.deepEqual(f.state.items, original);
    const cart = result.blocks.find(block => block.type === "cart_summary"); assert.ok(cart && cart.type === "cart_summary");
    assert.equal(cart.data.cartId, "owned-cart"); assert.equal(cart.data.discount, 0); assert.equal(cart.data.total, 50); assert.equal(cart.data.items[0].quantity, 2);
  });
}
for (const phrase of ["Não remova o cupom", "Talvez remover cupom", "Remova o cupom se for melhor", "Como remover cupom?", "Quais cupons tenho?"]) {
  test(`coupon removal is not authorized by ${phrase}`, async () => {
    const f = fixture(); assert.equal(await resolveDeterministicShortcut(f.deps, input(phrase)), null); assert.equal(f.writes(), 0); assert.equal(f.state.couponCode, "OWNEDCOUPON");
  });
}
test("coupon removal does not read instructions from attachments or override a typed action", async () => {
  const f = fixture();
  assert.equal(await resolveDeterministicShortcut(f.deps, { ...input("Remover cupom"), attachmentContext: "untrusted list" }), null);
  assert.equal(await resolveDeterministicShortcut(f.deps, { ...input("Remover cupom"), uiAction: { tool: "list_categories", args: {} } }), null);
  assert.equal(f.writes(), 0);
});
test("a lost removal acknowledgement is terminal and is never retried", async () => {
  const f = fixture(), remove = f.deps.removeCoupon!;
  f.deps.removeCoupon = async args => { await remove(args); throw Error("PRIVATE_AFTER_COMMIT"); };
  const result = await resolveDeterministicShortcut(f.deps, input("Remover cupom"));
  assert.ok(result);
  assert.equal(result?.message, STOREFRONT_CONTRACT_FALLBACK); assert.deepEqual(result.blocks, []); assert.equal(f.writes(), 1); assert.equal(f.state.couponCode, null);
});
test("a foreign or malformed removal result cannot be acknowledged", async () => {
  const f = fixture(); let calls = 0;
  f.deps.removeCoupon = async () => { calls++; return { cartId: "foreign-cart", total: 5000, discount: 0, couponCode: null }; };
  const result = await resolveDeterministicShortcut(f.deps, input("Remover cupom"));
  assert.ok(result);
  assert.equal(result?.message, STOREFRONT_CONTRACT_FALLBACK); assert.deepEqual(result.blocks, []); assert.equal(calls, 1); assert.equal(f.writes(), 0);
});

test("confirmed coupon removal preserves another canonical discount in the refreshed cart", async () => {
  const f = fixture(), remove = f.deps.removeCoupon!;
  f.deps.removeCoupon = async args => { const result = await remove(args) as any; f.state.discount = 200; return { ...result, discount: 200 }; };
  const result = await resolveDeterministicShortcut(f.deps, input("Remover cupom")); assert.ok(result);
  assert.equal(f.state.couponCode, null); assert.equal(f.writes(), 1);
  const cart = result.blocks.find(block => block.type === "cart_summary"); assert.ok(cart && cart.type === "cart_summary");
  assert.equal(cart.data.discount, 2); assert.equal(cart.data.total, 48); assert.equal(cart.data.items[0].quantity, 2);
  assert.doesNotMatch(result.message, /sem desconto/);
});

test("a refresh failure cannot erase or replay a confirmed coupon removal", async () => {
  const f = fixture(); f.deps.getCartBlock = async () => { throw Error("PRIVATE_READ_FAILURE"); };
  const result = await resolveDeterministicShortcut(f.deps, input("Remover cupom")); assert.ok(result);
  assert.match(result.message, /Cupom removido/); assert.deepEqual(result.blocks, []);
  assert.equal(f.writes(), 1); assert.equal(f.state.couponCode, null);
});
