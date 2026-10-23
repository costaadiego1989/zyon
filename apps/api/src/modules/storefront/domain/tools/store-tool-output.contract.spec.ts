import test from "node:test";
import assert from "node:assert/strict";
import { buildStoreTools } from "./index.js";
import { wrapHandler } from "./types.js";
import { createAllowedScopeAgent } from "../../infrastructure/agents/storefront-scope.fixture.js";
import type { OpenRouterProvider, OpenRouterChatRequest } from "@zyon/conversation-engine";

const cart = { cartId: "cart", items: [{ variantId: "v1", name: "Produto", quantity: 1, unitPrice: 10, lineTotal: 10 }], total: 10, itemCount: 1 };
const product = { id: "p1", name: "Produto", price: 1000, inStock: true };
const review = { id: "r1", productId: "p1", author: "Cliente", rating: 5, text: "Ótimo", date: "2026-10-16", status: "pending_moderation" };
export const validToolResults = {
  search_products: { products: [product], nextCursor: null },
  get_product_details: { product },
  compare_products: { comparison: [{ ...product, attributes: {}, stock: 1 }], missingProductNames: [], requiresProductNames: true },
  get_product_availability: { inStock: true, quantity: 1 },
  add_item_to_cart: cart,
  get_cart: cart,
  remove_cart_item: cart,
  update_cart_item: cart,
  clear_cart: { cartId: "cart", items: [], total: 0, itemCount: 0 },
  quote_shipping: { options: [{ carrier: "PAC", name: "PAC", price: 800, days: 7, zipCode: "01001000" }] },
  apply_coupon: { applied: false, reason: "cart_empty" },
  list_promotions: { promotions: [], coupons: [], advancedRules: [] },
  remove_coupon: { cartId: "cart", total: 1000, discount: 0, couponCode: null },
  list_categories: { categories: [{ id: "c1", name: "Categoria", productCount: 1 }] },
  create_checkout_session: { checkoutUrl: "https://checkout.example.test/embed/checkout/chk_1", sessionId: "chk_1" },
  get_reviews: { reviews: [], totalCount: 0, averageRating: 0 },
  create_review: review,
  get_product_questions: { questions: [{ id: "q1", question: "Tamanho?", answer: "Médio" }], totalCount: 1 },
  create_question: { id: "q1", productId: "p1", author: "Cliente", question: "Tamanho?", date: "2026-10-16", status: "awaiting_answer" },
  get_similar_products: { products: [product] },
  add_to_wishlist: { added: true, productId: "p1", items: [product], message: "Salvo" },
  get_wishlist: { items: [product], message: "Sua lista" },
  remove_from_wishlist: { removed: true, productId: "p1", items: [], message: "Removido" },
  track_order: { orderId: "o1", found: true, status: "paid", statusLabel: "Pagamento aprovado", trackingAvailable: false },
  get_store_policies: { configured: true, policies: { returns: "Consulte o atendimento." } },
  get_buyer_profile: { message: "Consulte seu perfil" },
  get_daily_deals: { deals: [{ ...product, originalPrice: 2000, discountPercent: 50 }] },
  get_faq: { faqs: [{ question: "Como comprar?", answer: "Use o carrinho." }] },
  escalate_to_human: { escalated: true, ticketId: "t1", message: "Encaminhado", reason: "Ajuda" },
  get_invoice: { orderId: "o1", invoiceAvailable: false, message: "Consulte o atendimento" },
  cancel_order: { orderId: "o1", cancellationAvailable: false, status: "unavailable", message: "Consulte o atendimento" },
} as const;

const validArgs: Record<keyof typeof validToolResults, Record<string, unknown>> = {
  search_products: { query: "produto" }, get_product_details: { productId: "p1" }, compare_products: { productId: "p1" },
  get_product_availability: { variantId: "v1" }, add_item_to_cart: { variantId: "v1", quantity: 1 },
  get_cart: { cartId: "cart" }, remove_cart_item: { cartId: "cart", variantId: "v1" }, update_cart_item: { cartId: "cart", variantId: "v1", quantity: 1 },
  clear_cart: { cartId: "cart" }, quote_shipping: { zipCode: "01001000" }, apply_coupon: { couponCode: "PROMO" },
  list_promotions: {}, remove_coupon: { cartId: "cart" }, list_categories: {}, create_checkout_session: { cartId: "cart" },
  get_reviews: { productId: "p1" }, create_review: { productId: "p1", rating: 5, text: "Ótimo", authorName: "Cliente", authorPhone: "11999990000" },
  get_product_questions: { productId: "p1" }, create_question: { productId: "p1", question: "Tamanho?", authorName: "Cliente" },
  get_similar_products: { productId: "p1" }, add_to_wishlist: { productId: "p1" }, get_wishlist: {}, remove_from_wishlist: { productId: "p1" },
  track_order: { orderId: "o1" }, get_store_policies: {}, get_buyer_profile: {}, get_daily_deals: {}, get_faq: {},
  escalate_to_human: { reason: "Ajuda" }, get_invoice: { orderId: "o1" }, cancel_order: { orderId: "o1" },
};

test("output fixtures cover every advertised native tool", () => {
  assert.deepEqual(Object.keys(validToolResults).sort(), buildStoreTools().map(tool => tool.name).sort());
});

for (const name of Object.keys(validToolResults) as Array<keyof typeof validToolResults>) {
  test(`output contract: ${name} preserves its valid handler result`, async () => {
    const result = await wrapHandler(name, async () => validToolResults[name]).execute(validArgs[name]);
    assert.deepEqual(result, { ok: true, data: validToolResults[name] });
  });
  test(`output contract: ${name} rejects malformed output after one execution`, async () => {
    let calls = 0;
    for (const data of [null, "PRIVATE_RESULT", [], {}, { error: 123 }]) {
      const result = await wrapHandler(name, async () => { calls++; return data; }).execute(validArgs[name]);
      assert.deepEqual(result, { ok: false, error: "invalid_tool_output", code: "invalid_tool_output" });
    }
    assert.equal(calls, 5);
  });
}

test("output projection removes private variant fields before the model and callbacks", async () => {
  const result = await wrapHandler("get_product_details", async () => ({
    product: { ...product, variants: [{ id: "v1", sku: "SKU", basePriceInCents: 1000, costInCents: 100,
      taxPercent: 2, currency: "BRL", supplierSecret: "PRIVATE_RESULT", attributes: { Cor: "Azul" }, media: [] }] },
    internalNotes: "PRIVATE_RESULT",
  })).execute(validArgs.get_product_details);
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESULT|costInCents|taxPercent/);
  assert.match(JSON.stringify(result), /basePriceInCents/);
});

for (const data of [
  { ...cart, total: -1 }, { ...cart, total: "10" }, { ...cart, items: [{ ...cart.items[0], quantity: 0 }] },
  { ...cart, items: [{ ...cart.items[0], unitPrice: Infinity }] },
  { ...cart, success: false }, { ...cart, ok: false },
]) {
  test(`cart output rejects invalid money or quantity: ${JSON.stringify(data)}`, async () => {
    assert.equal((await wrapHandler("get_cart", async () => data).execute(validArgs.get_cart)).ok, false);
  });
}

test("domain errors preserve safe selection and identification contracts", async () => {
  for (const [name, args, data] of [
    ["add_item_to_cart", validArgs.add_item_to_cart, { error: "variant_selection_required", variantSelection: { productId: "p1", productName: "Produto", variants: [{ id: "v1", label: "Azul" }] } }],
    ["create_review", validArgs.create_review, { error: "Identifique-se", requiresIdentification: true }],
  ] as const) assert.deepEqual(await wrapHandler(name, async () => data).execute(args), { ok: true, data });
});

test("the agent feeds only projected tool results to the provider and callbacks", async () => {
  let calls = 0; const callbacks: unknown[] = [];
  const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
  const agent = createAllowedScopeAgent({ provider: { chat: async (request: OpenRouterChatRequest) => {
    if (++calls === 1) return { content: "", toolCalls: [{ id: "details", name: "get_product_details", args: { productId: "p1" } }], usage };
    assert.doesNotMatch(JSON.stringify(request.messages.filter(message => message.role === "tool")), /PRIVATE_RESULT|costInCents/);
    return { content: JSON.stringify({ schemaVersion: 1, message: "Aqui estão os detalhes." }), usage };
  } } as unknown as OpenRouterProvider, toolHandlers: { getProductDetails: async () => ({ product: { ...product,
    variants: [{ id: "v1", sku: "SKU", basePriceInCents: 1000, costInCents: 100, supplierSecret: "PRIVATE_RESULT" }] } }) } as never });
  const result = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", storeCategory: "others", history: [],
    userMessage: "Detalhes do produto", callbacks: { onToolResult: (_name, data) => callbacks.push(data) } });
  assert.equal(calls, 2); assert.equal(callbacks.length, 1);
  assert.doesNotMatch(JSON.stringify(callbacks), /PRIVATE_RESULT|costInCents/);
  assert.ok(result.blocks.some(block => block.type === "product_card"));
});

test("invalid output after an agent cart write stays unknown without retries", async () => {
  let calls = 0; let writes = 0; let fallbackCalls = 0;
  const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
  const agent = createAllowedScopeAgent({ provider: { chat: async () => { calls++; return { content: "", toolCalls: [{ id: "add", name: "add_item_to_cart", args: { variantId: "v1", quantity: 1 } }], usage }; } } as unknown as OpenRouterProvider,
    fallbackProvider: { chat: async () => { fallbackCalls++; throw new Error("must_not_replay"); } } as unknown as OpenRouterProvider,
    toolHandlers: { addItemToCart: async () => { writes++; return { cartId: "cart", total: "PRIVATE_RESULT", items: [] }; } } as never });
  const result = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", storeCategory: "others", history: [], userMessage: "Adicionar ao carrinho [variantId:v1]" });
  assert.equal(calls, 1); assert.equal(writes, 1); assert.equal(fallbackCalls, 0);
  assert.ok(result.blocks.some(block => block.type === "cart_add_result" && block.data.status === "unknown"));
  assert.match(result.message, /confirmar/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESULT/);
});

