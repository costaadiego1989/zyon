import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createProductHandlers } from "../tool-handlers/product.handlers.js";
import { createReviewHandlers } from "../tool-handlers/review.handlers.js";
import { ProductEntity } from "../../../catalog/domain/entities/product.entity.js";
import { storefrontToolArgumentSchemas } from "../../domain/contracts/storefront-tool.schemas.js";
import { ensureProductDiscovery } from "./product-discovery-fallback.js";

const name = "QA Físico R$3 - teste sem envio";
const comment = "[QA TESTE SINTÉTICO] Avaliação criada pela automação para validar moderação; não representa experiência real de cliente.";
const message = `Quero enviar uma avaliação do produto ${name}. Autor: QA Teste. Nota: 3 de 5. Comentário: ${comment}`;
const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
const support = { domain: "STORE_SUPPORT" as const, intent: "COMPLEX_QUESTION" as const, needsProductDiscovery: false, requiresTool: false };
const product = new ProductEntity({ id: "owned-product", merchantId: "merchant-a", name, type: "physical", isActive: true,
  createdAt: new Date(), updatedAt: new Date(), variants: [{ id: "own-v", sku: "qa", attributes: {}, isActive: true,
    basePriceInCents: 300, currency: "BRL", stockQuantity: 0, stockReserved: 0, taxPercent: 0, media: [] }] });

function fixture(authenticated: boolean) {
  const reads: any[] = [], writes: any[] = [];
  const buyer = authenticated ? { globalUserId: "canonical-owner", name: "Comprador" } : undefined;
  const context = { merchantId: "merchant-a", sessionId: "conversation-a", userMessage: message, buyer };
  const products = createProductHandlers({ productRepo: { search: async (args: any) => {
    reads.push(args); assert.equal(args.merchantId, "merchant-a"); assert.equal(args.query, name);
    return { products: [product], total: 1 };
  } }, prisma: { checkoutSetting: { findUnique: async () => null } } } as never, context);
  const reviews = createReviewHandlers({ prisma: {} as never, submitTestimonial: { execute: async (input: any) => {
    writes.push(input); return { id: "persisted-pending-testimonial", productId: input.productId };
  } } as never }, context);
  return { handlers: { ...products, ...reviews }, reads, writes, buyer };
}

test("review submission resolves only the product name then persists once with canonical identity and pending moderation", async () => {
  for (const structuredRouting of [false, true]) for (const typedLookup of [false, true]) {
    const f = fixture(true); let calls = 0;
    const lookupArgs = { query: name, ...(typedLookup ? { criteria: { version: 1, query: name, minRating: 3,
      minPriceCents: 500, maxPriceCents: 3000, attributes: [], unsupportedCriteria: [] } } : {}) };
    const agent = createAllowedScopeAgent({ structuredRouting, toolHandlers: f.handlers as never,
      provider: { chat: async (request: any) => {
        assert.ok(!request.messages[0].content.includes("DESCOBERTA OPCIONAL"));
        calls++;
        if (calls === 1) return { content: "", toolCalls: [{ id: "lookup", name: "search_products", args: lookupArgs }], usage };
        if (calls === 2) return { content: "", toolCalls: [{ id: "submit", name: "create_review", args: {
          productId: "owned-product", rating: 3, text: comment, authorName: "QA Teste", authorPhone: "untrusted-model-phone",
        } }], usage };
        return { content: JSON.stringify({ schemaVersion: 1, message: "Avaliação recebida e aguardando moderação." }), usage };
      } } as never }, support);
    const result = await agent.run({ merchantId: "merchant-a", sessionId: "conversation-a", cartId: "cart-a",
      userMessage: message, history: [], buyerContext: f.buyer });
    assert.equal(calls, 3); assert.equal(f.reads.length, 1); assert.equal(f.writes.length, 1);
    assert.equal(f.reads[0].inStockOnly, false); assert.equal(f.reads[0].minRating, undefined);
    assert.equal(f.reads[0].minPriceCents, undefined); assert.equal(f.reads[0].maxPriceCents, undefined);
    assert.deepEqual(f.writes[0], { merchantId: "merchant-a", productId: "owned-product", authorName: "QA Teste",
      body: comment, rating: 3, buyerId: "canonical-owner" });
    assert.deepEqual(result.toolsUsed, ["search_products", "create_review"]);
    assert.match(result.message, /aguardando moderação/);
    assert.equal(result.blocks.some(block => ["product_card", "product_carousel", "cart_summary"].includes(block.type)), false);
    assert.equal(result.routing.needsProductDiscovery, false);
  }
});

test("model-supplied author and phone cannot authorize a review without canonical buyer identity", async () => {
  const f = fixture(false); let calls = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: f.handlers as never, provider: { chat: async () => {
    calls++;
    if (calls === 1) return { content: "", toolCalls: [{ id: "lookup", name: "search_products", args: { query: name } }], usage };
    if (calls === 2) return { content: "", toolCalls: [{ id: "submit", name: "create_review", args: {
      productId: "owned-product", rating: 3, text: comment, authorName: "QA Teste", authorPhone: "forged",
    } }], usage };
    return { content: JSON.stringify({ schemaVersion: 1, message: "Preciso identificar seu cadastro antes de enviar a avaliação." }), usage };
  } } as never }, support);
  const result = await agent.run({ merchantId: "merchant-a", sessionId: "conversation-a", userMessage: message, history: [] });
  assert.equal(f.reads.length, 1); assert.equal(f.writes.length, 0);
  assert.match(result.message, /identificar seu cadastro/);
  assert.equal(result.routing.needsProductDiscovery, false);
  assert.equal(storefrontToolArgumentSchemas.search_products.safeParse({ query: "*", lookupOnly: true }).success, false);
});

test("support without an actionable product lookup never falls back into catalog discovery", async () => {
  let reads = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: {} as never, provider: { chat: async () => ({ usage,
    content: JSON.stringify({ schemaVersion: 1, message: "Qual produto você deseja avaliar?" }) }) } as never }, support);
  const result = await agent.run({ merchantId: "merchant-a", sessionId: "conversation-a", userMessage: "Quero avaliar um produto", history: [] });
  const preserved = await ensureProductDiscovery(result, { merchantId: "merchant-a", userMessage: "Quero avaliar um produto",
    discoveryDecision: result.routing.needsProductDiscovery, handlers: { searchProducts: async () => { reads++; throw Error("must_not_search"); } } as never });
  assert.equal(reads, 0); assert.equal(preserved.message, "Qual produto você deseja avaliar?");
});

test("a typed lookup for comparison continues to the destination tool instead of terminating with catalog evidence", async () => {
  const f = fixture(true); let calls = 0, comparisons = 0;
  const agent = createAllowedScopeAgent({ toolHandlers: { ...f.handlers, compareProducts: async () => {
    comparisons++; return { comparison: [{ id: product.id, name, price: 300, attributes: {} },
      { id: "second-owned", name: "Outro produto", price: 500, attributes: {} }] };
  } } as never, provider: { chat: async () => {
    calls++;
    if (calls === 1) return { content: "", toolCalls: [{ id: "lookup", name: "search_products", args: { query: name,
      criteria: { version: 1, query: name, attributes: [], unsupportedCriteria: [] } } }], usage };
    if (calls === 2) return { content: "", toolCalls: [{ id: "compare", name: "compare_products", args: { productId: product.id } }], usage };
    return { content: JSON.stringify({ schemaVersion: 1, message: "Confira a comparação dos produtos." }), usage };
  } } as never }, { domain: "STORE_COMMERCE", intent: "COMPARE_PRODUCTS", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ merchantId: "merchant-a", sessionId: "conversation-a", userMessage: `Compare ${name} com outro produto`, history: [] });
  assert.equal(comparisons, 1); assert.equal(calls, 3);
  assert.ok(result.blocks.some(block => block.type === "product_comparison"));
  assert.equal(result.blocks.some(block => block.type === "product_carousel"), false);
});
