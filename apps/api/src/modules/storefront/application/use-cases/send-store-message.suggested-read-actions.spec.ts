import test from "node:test";
import assert from "node:assert/strict";
import { SendStoreMessageUseCase } from "./send-store-message.use-case.js";
import { STOREFRONT_CONTRACT_FALLBACK, sendStoreMessageOutputSchema, storefrontConversationOutputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";
import { buildConversationBlocks } from "../../infrastructure/agents/conversation-block.builder.js";

const product = { id: "product", name: "Mesmo nome", price: 1000, priceFormatted: "R$ 10,00", inStock: true };
const category = { type: "category_carousel", data: { categories: [{ id: "category", name: "Mesmo nome", productCount: 1 }] } };
const generated = { message: "Confira as opções.", blocks: [category, { type: "product_card", data: product }], cartId: "conversation", suggestedNext: ["Ver carrinho", "Aplicar cupom TESTE"] };
const envelope = { version: 1, items: [
  { id: "read-action-1", label: "Ver produtos de Mesmo nome", action: { tool: "search_products", args: { query: "*", categoryId: "category" } } },
  { id: "read-action-2", label: "Ver detalhes de Mesmo nome", action: { tool: "get_product_details", args: { productId: "product" } } },
] };
function fixture(reply: unknown) {
  let generations = 0;
  const useCase = new SendStoreMessageUseCase({ getProfile: async () => ({ name: "Store", storeCategory: "others" }), getStoreSettings: async () => ({}) } as never,
    { reply: async () => { generations += 1; return reply; } } as never,
    { merchantRule: { findUnique: async () => null }, checkoutSetting: { findUnique: async () => null }, promptExperiment: { findFirst: async () => null } } as never,
    { findForMerchant: async () => null });
  return { useCase, generations: () => generations };
}
const input = { merchant_id: "merchant", conversation_id: "conversation", cart_id: "conversation", user_message: "Ver opções" };

test("suggested read actions are added only to validated final HTTP output, preserving legacy fields", async () => {
  const f = fixture(generated);
  const output = await f.useCase.execute(input);
  assert.deepEqual(output, { message: generated.message, blocks: generated.blocks, cart_id: "conversation", conversation_id: "conversation",
    suggested_next: generated.suggestedNext, suggested_actions: envelope });
  assert.equal(f.generations(), 1);
  assert.equal(sendStoreMessageOutputSchema.safeParse(output).success, true);
});

test("suggested action projection is independent of the buyer label and model suggestedNext strings", async () => {
  const f = fixture({ ...generated, suggestedNext: ["create_checkout_session", "Detalhes OUTRO [variantId:foreign]"] });
  const output = await f.useCase.execute({ ...input, user_message: "Aplicar cupom [merchantId:foreign]" });
  assert.ok("suggested_actions" in output);
  assert.deepEqual(output.suggested_actions, envelope);
  assert.equal(f.generations(), 1);
});

for (const field of ["suggested_actions", "suggestedActions"]) test(`model-supplied ${field} remains invalid generation output and emits no suggestions or retry`, async () => {
  const injected = { ...generated, [field]: envelope };
  assert.equal(storefrontConversationOutputSchema.safeParse(injected).success, false);
  const f = fixture(injected);
  const output = await f.useCase.execute(input);
  assert.equal(output.message, STOREFRONT_CONTRACT_FALLBACK);
  assert.deepEqual(output.blocks, []);
  assert.ok(!Object.hasOwn(output, "suggested_actions"));
  assert.equal(f.generations(), 1);
});

for (const source of ["get_product_details", "add_item_to_cart"]) {
for (const mode of [undefined, "inline", "modal", "banner", "interstitial"]) {
test(`real cross-sell builder ${source}/${mode ?? "default"} survives validation and projects productId, not SKU`, async () => {
  const built = buildConversationBlocks({ merchantId: "merchant", userMessage: "", finalContent: "Confira.", toolResults: {
    [source]: { ...(source === "get_product_details" ? { product: { ...product, variants: [] } } : {}), crossSellDisplayMode: mode,
      crossSellSuggestions: [{ sku: "SKU_NOT_PRODUCT", productId: "cross_product", name: "Complemento", price: 1000 }] },
  } });
  const crossSell = built.blocks.find(block => block.type === "cross_sell");
  assert.ok(crossSell);
  assert.ok("displayMode" in crossSell.data);
  assert.equal(crossSell.data.displayMode, mode ?? "interstitial");
  const f = fixture({ ...generated, blocks: built.blocks });
  const output = await f.useCase.execute(input);
  assert.equal(output.message, generated.message);
  assert.deepEqual(output.blocks, built.blocks);
  assert.equal(sendStoreMessageOutputSchema.safeParse(output).success, true);
  assert.ok(output.suggested_actions);
  assert.ok(output.suggested_actions.items.some(item => item.action.tool === "get_product_details" && item.action.args.productId === "cross_product"));
  assert.ok(output.suggested_actions.items.every(item => item.action.tool !== "get_product_details" || item.action.args.productId !== "SKU_NOT_PRODUCT"));
  assert.equal(f.generations(), 1);
});
}
}

test("real cross-sell builder with only SKU remains display-only, without an invented product read", async () => {
  const built = buildConversationBlocks({ merchantId: "merchant", userMessage: "", finalContent: "Confira.", toolResults: {
    add_item_to_cart: { crossSellDisplayMode: "inline", crossSellSuggestions: [{ sku: "ONLY_SKU", name: "Complemento", price: 1000 }] },
  } });
  const f = fixture({ ...generated, blocks: built.blocks });
  const output = await f.useCase.execute(input);
  assert.equal(output.message, generated.message);
  assert.deepEqual(output.blocks, built.blocks);
  assert.ok(!Object.hasOwn(output, "suggested_actions"));
  assert.equal(f.generations(), 1);
});

for (const mode of ["", "INLINE", " inline", "drawer", 1, {}, []]) {
test(`real cross-sell builder rejects invalid mode ${JSON.stringify(mode)} without replay`, async () => {
  const built = buildConversationBlocks({ merchantId: "merchant", userMessage: "", finalContent: "Confira.", toolResults: {
    add_item_to_cart: { crossSellDisplayMode: mode, crossSellSuggestions: [{ sku: "SKU", productId: "cross_product", name: "Complemento", price: 1000 }] },
  } });
  const f = fixture({ ...generated, blocks: built.blocks });
  const output = await f.useCase.execute(input);
  assert.equal(output.message, STOREFRONT_CONTRACT_FALLBACK);
  assert.deepEqual(output.blocks, []);
  assert.ok(!Object.hasOwn(output, "suggested_actions"));
  assert.equal(f.generations(), 1);
});
}

for (const reply of [
  { ...generated, blocks: [] },
  { ...generated, blocks: [{ type: "product_carousel", data: { merchantId: "foreign", products: [product] } }] },
  { ...generated, blocks: [{ type: "product_card", data: { ...product, price: -1 } }] },
]) {
  test(`absent or rejected blocks never produce suggested actions: ${JSON.stringify(reply.blocks).slice(0, 90)}`, async () => {
    const f = fixture(reply);
    const output = await f.useCase.execute(input);
    assert.ok(!Object.hasOwn(output, "suggested_actions"));
    assert.equal(f.generations(), 1);
  });
}

