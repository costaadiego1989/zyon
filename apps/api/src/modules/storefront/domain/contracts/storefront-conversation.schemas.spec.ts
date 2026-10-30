import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { conversationBlockSchema } from "./conversation-block.schemas.js";
import { sendStoreMessageOutputSchema, storefrontConversationInputSchema, storefrontConversationOutputSchema } from "./storefront-conversation.schemas.js";
import { storefrontToolArgumentSchemas, storefrontToolSchema } from "./storefront-tool.schemas.js";
import { buildStoreTools } from "../tools/index.js";
import { buildConversationBlocks } from "../../infrastructure/agents/conversation-block.builder.js";

const product = { id: "book", name: "Livro", price: 1500, priceFormatted: "R$ 15,00", inStock: true };
const card = { type: "product_card", data: product };
for (const displayMode of ["inline", "modal", "banner", "interstitial"]) {
  test(`schema: cross-sell accepts known display mode ${displayMode} without changing JSON`, () => {
    const block = { type: "cross_sell", data: { trigger: "similar", displayMode, products: [product] } };
    assert.deepEqual(conversationBlockSchema.parse(JSON.parse(JSON.stringify(block))), block);
    assert.equal(storefrontConversationOutputSchema.safeParse({ message: "Confira.", blocks: [block] }).success, true);
    assert.equal(sendStoreMessageOutputSchema.safeParse({ message: "Confira.", blocks: [block], conversation_id: "conversation", suggested_next: [] }).success, true);
  });
}
for (const displayMode of ["", "INLINE", " inline", "drawer", null, 1, {}, []]) {
  test(`schema: cross-sell rejects invalid display mode ${JSON.stringify(displayMode)}`, () => {
    const block = { type: "cross_sell", data: { trigger: "similar", displayMode, products: [product] } };
    assert.equal(conversationBlockSchema.safeParse(block).success, false);
  });
}
test("schema: known cross-sell mode does not admit unknown fields or invalid prices", () => {
  const data = { trigger: "similar", displayMode: "inline", products: [product] };
  assert.equal(conversationBlockSchema.safeParse({ type: "cross_sell", data: { ...data, execute: "clear_cart" } }).success, false);
  assert.equal(conversationBlockSchema.safeParse({ type: "cross_sell", data: { ...data, products: [{ ...product, price: -1 }] } }).success, false);
});
const blocks = [
  card,
  { type: "product_carousel", data: { products: [product], merchantId: "merchant", nextCursor: "next" } },
  { type: "comparison_table", data: { products: [{ id: "book", name: "Livro", price: 1500, attributes: {}, stock: 1 }], attributes: [] } },
  { type: "cart_summary", data: { cartId: "conversation", items: [{ variantId: "variant", productName: "Livro", quantity: 1, price: 15, subtotal: 15 }], itemCount: 1, subtotal: 15, total: 15 } },
  { type: "cart_add_result", data: { cartId: "conversation", variantId: "variant", status: "succeeded", optionItemIds: [] } },
  { type: "shipping_options", data: { options: [{ carrier: "Carrier", name: "Normal", price: 500, priceFormatted: "R$ 5,00", days: 3 }] } },
  { type: "quick_replies", data: { options: ["Ver produtos"] } },
  { type: "checkout_redirect", data: { url: "/checkout/conversation", sessionId: "conversation" } },
  { type: "checkout_prepared", data: { actionId: "action", cartId: "conversation", shippingPreference: "cheapest", paymentPreference: "pix" } },
  { type: "order_confirmation", data: { orderId: "order", total: 15, items: [{ productName: "Livro", quantity: 1, price: 15 }] } },
  { type: "shipping_quote_input", data: { productName: "Livro", productId: "book" } },
  { type: "variant_selector", data: { productId: "book", productName: "Livro", groups: [{ name: "Tipo", options: [{ id: "variant", value: "Azul", available: true }] }] } },
  { type: "product_comparison", data: { products: [{ ...product, attributes: {} }] } },
  { type: "wishlist", data: { items: [product] } },
  { type: "reviews", data: { productId: "book", productName: "Livro", averageRating: 5, totalReviews: 1, reviews: [{ id: "review", author: "Buyer", rating: 5, text: "Ótimo", date: "2026-10-16" }] } },
  { type: "add_review", data: { productId: "book", productName: "Livro" } },
  { type: "review_submission", data: { productId: "book", reviewId: "review", status: "pending_moderation" } },
  { type: "product_questions", data: { productId: "book", productName: "Livro", scope: "public_answered", filter: "answered",
    questions: [{ id: "faq", question: "Qual material?", answer: "Papel." }], totalCount: 1 } },
  { type: "question_submission", data: { productId: "book", ticketId: "ticket", questionMessageId: "question", status: "awaiting_answer" } },
  { type: "buyer_product_questions", data: { productId: "book", productName: "Livro", scope: "buyer_history", filter: "mine",
    questions: [{ id: "question", ticketId: "ticket", question: "Qual material?", date: "2026-10-29T12:00:00Z", answerState: "not_linked" }],
    returnedCount: 1, hasMore: false, historyLimited: true } },
  { type: "product_question_input", data: { productId: "book", productName: "Livro" } },
  { type: "cross_sell", data: { trigger: "similar", products: [{ ...product, promoId: "promo", discountPercent: 10 }] } },
  { type: "coupon_list", data: { coupons: [{ code: "CUPOM", description: "Promoção", expiresAt: null }] } },
  { type: "category_carousel", data: { categories: [{ id: "books", name: "Livros", productCount: 1 }] } },
];

for (const block of blocks) {
  test(`schema: ${block.type} accepts its current display contract and survives JSON serialization`, () => {
    assert.deepEqual(conversationBlockSchema.parse(block), block);
    const output = { message: "Confira as opções.", blocks: [block] };
    assert.deepEqual(storefrontConversationOutputSchema.parse(JSON.parse(JSON.stringify(output))), output);
  });
  test(`schema: ${block.type} rejects arbitrary nested fields`, () => {
    assert.equal(conversationBlockSchema.safeParse({ ...block, data: { ...block.data, execute: "unsafe" } }).success, false);
  });
}

test("schema: every display variant has a fixture, with no fallback catch-all", () => {
  assert.deepEqual(new Set(conversationBlockSchema.options.map(option => option.shape.type.value)), new Set(blocks.map(block => block.type)));
});

test("schema: runtime and provider tool contracts come from the same strict schemas", () => {
  const advertised = buildStoreTools();
  assert.equal(advertised.length, Object.keys(storefrontToolArgumentSchemas).length);
  for (const tool of advertised) {
    const schema = storefrontToolSchema(tool.name);
    assert.ok(schema);
    const json = z.toJSONSchema(schema, { target: "draft-7" });
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(Object.keys(tool.parameters.properties).sort(), Object.keys(json.properties ?? {}).sort());
    assert.deepEqual(tool.parameters.required, json.required);
  }
  assert.equal(storefrontToolSchema("__proto__"), undefined);
  assert.equal(storefrontToolSchema("not_a_tool"), undefined);
});

test("schema: invalid numeric and nested values cannot pass as structured output", () => {
  for (const price of [-1, NaN, Infinity, "15"]) {
    assert.equal(conversationBlockSchema.safeParse({ ...card, data: { ...product, price } }).success, false);
  }
  assert.equal(conversationBlockSchema.safeParse({ ...card, data: { ...product, variants: [{ id: "v", name: "Cor", value: "Azul", stock: -1 }] } }).success, false);
  assert.equal(storefrontConversationOutputSchema.safeParse({ message: "Resposta", blocks: [card], tool: "clear_cart" }).success, false);
});

test("schema: public response keeps its existing keys without injecting schema metadata", () => {
  const output = { message: "Confira.", blocks: [], conversation_id: "conversation", suggested_next: [] };
  assert.deepEqual(sendStoreMessageOutputSchema.parse(output), output);
  assert.equal(sendStoreMessageOutputSchema.safeParse({ ...output, schemaVersion: 1 }).success, false);
});

test("schema: the context contract validates policy bounds and never accepts executable settings", () => {
  const input = { userMessage: "Olá", merchantId: "merchant", sessionId: "conversation", history: [], storeCategory: "books" };
  assert.equal(storefrontConversationInputSchema.safeParse(input).success, true);
  assert.equal(storefrontConversationInputSchema.safeParse({ ...input, merchantPolicy: { maxDiscountPercent: 101 } }).success, false);
  assert.equal(storefrontConversationInputSchema.safeParse({ ...input, storeSettings: { execute: () => {} } }).success, false);
});

test("schema: actual server-built catalog, cart, shipping, promotion and category blocks remain valid", () => {
  const scenarios = [
    { search_products: { products: [{ id: "book", name: "Livro", price: 1500, inStock: true }] } },
    { get_cart: { cartId: "conversation", itemCount: 1, total: 15, items: [{ variantId: "variant", name: "Livro", quantity: 1, unitPrice: 15, lineTotal: 15 }] } },
    { quote_shipping: { referenceOnly: true, options: [{ carrier: "Carrier", name: "Normal", price: 500, days: 3, zipCode: "01001000" }],
      reference: { id: "00000000-0000-4000-8000-000000000001", expiresAt: "2099-01-01T00:00:00.000Z", basisHash: "a".repeat(64),
        configurationHash: "b".repeat(64), destinationZip: "01001000", addressSource: "requested_cep" } } },
    { list_promotions: { coupons: [{ code: "CUPOM", type: "percent", value: 10, description: "Promoção", expiresAt: null }] } },
    { list_categories: { categories: [{ id: "books", name: "Livros", slug: "books", productCount: 1 }] } },
  ];
  for (const toolResults of scenarios) {
    const built = buildConversationBlocks({ toolResults, userMessage: "Ver opções", finalContent: "Confira.", merchantId: "merchant" });
    assert.ok(built.blocks.length > 0, Object.keys(toolResults)[0]);
    for (const block of built.blocks) assert.equal(conversationBlockSchema.safeParse(block).success, true, JSON.stringify(block));
  }
});

