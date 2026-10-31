import test from "node:test";
import assert from "node:assert/strict";
import { resolveDeterministicShortcut, type DeterministicShortcutDeps } from "./deterministic-shortcuts.service.js";
import type { StorefrontConversationInput } from "../../domain/ports/conversation.port.js";

const request = "Adicione mais uma unidade do Núcleo Sérum de Barreira que já está no meu carrinho.";
const input = (userMessage = request): StorefrontConversationInput => ({ merchantId: "merchant", sessionId: "conversation", cartId: "cart", userMessage, history: [], storeCategory: "beauty" });
const summary = () => ({ type: "cart_summary", data: { cartId: "cart", items: [{ variantId: "large", productName: "Núcleo — Sérum de Barreira", quantity: 1, price: 189.90, subtotal: 189.90 }], itemCount: 1, subtotal: 189.90, total: 189.90, discount: 0 } });
function fixture() {
  const state: { block: any; readError?: boolean; writeError?: boolean; response?: unknown; useResponse?: boolean } = { block: summary() };
  const reads: string[] = [], writes: any[] = [];
  const deps: DeterministicShortcutDeps = { productRepo: { search: async () => assert.fail("no catalogue guessing") } as any,
    copyService: { generateVariantCopy: async () => assert.fail("no model copy") } as any, emitFunnelEvent: async () => {},
    addItemToCart: async () => assert.fail("no unbound normal add"),
    getCartBlock: async cartId => { reads.push(cartId); if (state.readError) throw Error("read unavailable"); return structuredClone(state.block); },
    addExistingItemToCart: async (args, expected) => { writes.push({ args: structuredClone(args), expected: structuredClone(expected) });
      if (state.writeError) throw Error("commit acknowledgement unknown");
      if (state.useResponse) return state.response;
      const line = state.block.data.items[0], quantity = line.quantity + args.quantity;
      return { cartId: "cart", items: [{ variantId: "large", name: line.productName, quantity, unitPrice: line.price, lineTotal: line.price * quantity }],
        total: line.price * quantity, itemCount: quantity, discount: 0, freeShipping: false,
        addedItem: { variantId: "large", optionItemIds: [] },
        crossSellSuggestions: [{ name: "Complemento", sku: "target", productId: "target-product", price: 59.9, recommendationRuleId: "rule" }] };
    } };
  return { state, reads, writes, deps, run: (value = input()) => resolveDeterministicShortcut(deps, value, { structuredReadRouting: true }) };
}
test("exact live request executes canonical cart read then one ADD increment without model, markers or UPDATE", async () => {
  const f = fixture(), result = await f.run();
  assert(result); assert.deepEqual(f.reads, ["cart"]);
  assert.deepEqual(f.writes, [{ args: { cartId: "cart", variantId: "large", quantity: 1 }, expected: { variantId: "large", quantity: 1, unitPriceCents: 18990 } }]);
  assert.equal(result.blocks.find(b => b.type === "cart_add_result")?.data.status, "succeeded");
  assert.equal(result.blocks.find(b => b.type === "cart_summary")?.data.items[0]?.quantity, 2);
  assert.equal(result.blocks.find(b => b.type === "cross_sell")?.data.products[0]?.recommendationRuleId, "rule");
  assert.equal(request.includes("[variantId:"), false);
});
test("accents, title punctuation and case resolve only an exact published line name", async () => {
  const f = fixture(); const result = await f.run(input("POR FAVOR, adicione mais 1 unidade do NUCLEO SERUM DE BARREIRA que ja esta no meu carrinho."));
  assert.equal(result?.blocks.find(b => b.type === "cart_add_result")?.data.status, "succeeded"); assert.equal(f.writes.length, 1);
});
test("an explicitly requested increment2 is not replaced by the final total3", async () => {
  const f = fixture(), result = await f.run(input(request.replace("uma unidade", "duas unidades")));
  assert.equal(f.writes[0]?.args.quantity, 2); assert.equal(result?.blocks.find(b => b.type === "cart_summary")?.data.items[0]?.quantity, 3);
});
for (const message of [
  "Já adicionei uma unidade do Núcleo Sérum de Barreira que já está no meu carrinho.",
  "O Núcleo Sérum de Barreira já está no meu carrinho.",
  `Não ${request.toLowerCase()}`, `${request} Mas não quero mais adicionar.`,
  `Se for possível, ${request.toLowerCase()}`, `> ${request}`, `Repita: ${request}`,
  request.replace("uma unidade", "uma ou duas unidades"), request.replace("uma unidade", "1,5 unidades"), request.replace("uma unidade", "100 unidades"),
]) test(`no write for past/refused/conditional/quoted/ambiguous/invalid request: ${message}`, async () => {
  const f = fixture(); assert.equal(await f.run(input(message)), null); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
});
for (const extra of [{ attachmentContext: "Foto: adicionar sérum" }, { uiAction: { tool: "get_cart", args: {} } }])
  test(`attachments and UI actions retain their existing admission route: ${Object.keys(extra)[0]}`, async () => {
    const f = fixture(); assert.equal(await f.run({ ...input(), ...extra } as any), null); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  });
for (const mode of ["read-error", "missing", "foreign-cart", "malformed", "partial-name", "duplicate-name", "options", "slot", "fractional-price"])
  test(`canonical read fails closed without a writer for ${mode}`, async () => {
    const f = fixture(); let value = input();
    if (mode === "read-error") f.state.readError = true;
    if (mode === "missing") f.state.block.data.items = [];
    if (mode === "foreign-cart") f.state.block.data.cartId = "other-cart";
    if (mode === "malformed") delete f.state.block.data.total;
    if (mode === "partial-name") value = input(request.replace("Núcleo Sérum de Barreira", "Sérum"));
    if (mode === "duplicate-name") f.state.block.data.items.push({ ...f.state.block.data.items[0], variantId: "small" });
    if (mode === "options") f.state.block.data.items[0].optionItemIds = ["size"];
    if (mode === "slot") f.state.block.data.items[0].serviceSlotId = "booking-slot";
    if (mode === "fractional-price") f.state.block.data.items[0].price = 189.901;
    const result = await f.run(value); assert(result); assert.equal(f.writes.length, 0);
    assert.equal(result.blocks.some(b => b.type === "cart_add_result" && b.data.status === "succeeded"), false);
  });
for (const response of [undefined, { cartId: "other-cart", items: [] }, { error: "variant_out_of_stock" }, { error: "cross_sell_quote_review_required" }])
  test(`writer failure never falls through, retries or acknowledges success: ${JSON.stringify(response)}`, async () => {
    const f = fixture(); f.state.useResponse = true; f.state.response = response;
    const result = await f.run(); assert(result); assert.equal(f.writes.length, 1);
    assert.equal(result.blocks.find(b => b.type === "cart_add_result")?.data.status === "succeeded", false);
  });
test("unknown commit exception is terminal with one attempt and no reconstructed success", async () => {
  const f = fixture(); f.state.writeError = true; const result = await f.run();
  assert(result); assert.equal(f.writes.length, 1); assert.equal(result.blocks.find(b => b.type === "cart_add_result")?.data.status, "unknown");
});
