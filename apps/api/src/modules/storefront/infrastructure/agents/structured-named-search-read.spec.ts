import assert from "node:assert/strict";
import test from "node:test";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { createProductHandlers } from "../tool-handlers/product.handlers.js";
import { ProductEntity } from "../../../catalog/domain/entities/product.entity.js";
import { storefrontConversationOutputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";
import { SHOPPING_SEARCH_PLAN_UNCONFIRMED } from "../../domain/contracts/shopping-search-plan.schemas.js";

const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
function fixture(change: "none" | "read-error" | "malformed-plan" | "provider-error" | "missing-evidence" = "none") {
  const calls: any[] = [], reads: any[] = [];
  const product = new ProductEntity({ id: "serum", merchantId: "merchant", name: "Núcleo — Sérum de Barreira",
    isActive: true, createdAt: new Date(), updatedAt: new Date(),
    variants: [12990, 18990, 28990].map((price, index) => ({ id: `serum-${index}`, sku: `SERUM-${index}`,
      attributes: { volume: ["30ml", "50ml", "100ml"][index]! }, isActive: true, basePriceInCents: price,
      stockQuantity: 10, stockReserved: 0, taxPercent: 0, currency: "BRL", media: [] })) });
  const canonical = createProductHandlers({ productRepo: { search: async (args: any) => {
    reads.push(args); assert.equal(args.merchantId, "merchant");
    if (change === "read-error") throw Error("catalog_read_unavailable");
    return { products: [product], nextCursor: null };
  } }, prisma: { checkoutSetting: { findUnique: async () => null } } } as never,
  { merchantId: "merchant", sessionId: "cart" });
  const handlers = change === "missing-evidence" ? { ...canonical, searchProducts: async () => ({ products: [], nextCursor: null }) } : canonical;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: handlers as never,
    provider: { chat: async (request: any) => {
      calls.push(structuredClone(request));
      let phase: string | undefined;
      try { phase = JSON.parse(request.messages[0]?.content)?.id; } catch { /* Main narration has a non-JSON system prompt. */ }
      if (phase !== "storefront.shopping-plan") return { content: "", usage }; // Reproduces the real no-tool main/retry.
      assert.equal(request.tools, undefined); assert.equal(request.toolChoice, undefined);
      if (change === "provider-error") throw Error("planner_provider_unavailable");
      const plan = { version: 1, query: "Sérum de Barreira", minPriceCents: null, maxPriceCents: null,
        minRating: null, attributes: [], sortBy: null, delivery: null, unsupportedCriteria: [] };
      return { content: JSON.stringify({ schemaVersion: 1, plan: change === "malformed-plan" ? { ...plan, pay: true } : plan }), usage };
    } } as never }, { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true,
    needsProductDiscovery: true, shoppingPhase: "search" });
  return { agent, calls, reads };
}

for (const userMessage of ["Sérum de Barreira", "Mostre os detalhes do Núcleo Sérum de Barreira."]) {
  test(`a named product with a valid plain plan performs one scoped read despite a no-tool narrator: ${userMessage}`, async () => {
    const f = fixture();
    const result = await f.agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", storeCategory: "beauty", userMessage,
      history: [{ role: "user", content: "Não adicione nem cobre por uma consulta." }] });
    assert.equal(f.reads.length, 1, "a valid plan must not be left to optional model tool selection");
    assert.equal(f.reads[0].query, "Sérum de Barreira");
    assert.equal(f.calls.length, 1, "there is no main, retry or narration after the canonical search");
    assert.equal(f.agent.outputReviewRequests.length, 0);
    assert.deepEqual(result.toolsUsed, ["search_products"]);
    assert.equal(result.safetyValidation.safe, true);
    const output = storefrontConversationOutputSchema.parse({ message: result.message, blocks: result.blocks, cartId: "cart" });
    const catalog: any = output.blocks.find(block => block.type === "product_carousel");
    assert.equal(catalog.data.merchantId, "merchant");
    assert.equal(catalog.data.products[0].id, "serum");
    assert.equal(catalog.data.products[0].price, 12990);
    assert.equal(catalog.data.products[0].variants.length, 3);
    assert.equal(output.blocks.some(block => block.type === "cart_add_result" || block.type === "checkout_redirect"), false);
  });
}

for (const change of ["read-error", "malformed-plan", "provider-error", "missing-evidence"] as const) {
  test(`a plain search remains unconfirmed without retries or writes after ${change}`, async () => {
    const f = fixture(change);
    const result = await f.agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", storeCategory: "beauty",
      userMessage: "Sérum de Barreira", history: [] });
    assert.equal(result.message, SHOPPING_SEARCH_PLAN_UNCONFIRMED);
    assert.equal(result.safetyValidation.safe, false);
    assert.deepEqual(result.blocks, []);
    assert.equal(f.calls.length, 1);
    assert.equal(f.reads.length, change === "read-error" ? 1 : 0);
    assert.equal(f.agent.outputReviewRequests.length, 0);
  });
}
