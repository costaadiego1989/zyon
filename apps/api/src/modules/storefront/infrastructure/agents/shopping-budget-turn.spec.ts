import test from "node:test";
import assert from "node:assert/strict";
import { createAllowedScopeAgent } from "./storefront-scope.fixture.js";
import { shoppingSearchPlanSchema, SHOPPING_SEARCH_PLAN_UNCONFIRMED } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";

const usage = { promptTokens: 3, completionTokens: 5, totalTokens: 8 };
const input = { merchantId: "merchant", sessionId: "owned", cartId: "owned", storeCategory: "others", history: [],
  userMessage: "Consulte as condições e mostre a melhor alternativa dentro de R$70. Não adicione nem cobre." };
const wire = (maxPriceCents: number | null) => ({ schemaVersion: 1, plan: { version: 1, query: "organizador",
  minPriceCents: null, maxPriceCents, minRating: null, attributes: [], sortBy: null, delivery: null, unsupportedCriteria: [] } });

test("a constrained negotiation/recommendation has one immutable plan and one canonical result, never an unfiltered offer carousel", async () => {
  let modelCalls = 0, reads = 0, writes = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async request => {
    modelCalls++;
    assert.equal(JSON.parse(request.messages[0]!.content!).id, "storefront.shopping-plan");
    return { content: JSON.stringify(wire(7000)), usage };
  } } as never, toolHandlers: {
    recommendProducts: async ({ criteria }: any) => {
      reads++; assert.equal(criteria.maxPriceCents, 7000);
      return { products: [{ id: "essencial", name: "Essencial", price: 6000, inStock: true }],
        searchEvidence: shoppingSearchEvidence(criteria, 1) };
    },
    getDailyDeals: async () => { throw Error("unfiltered_offer_must_not_run"); },
    listPromotions: async () => { throw Error("unfiltered_promotions_must_not_run"); },
    addItemToCart: async () => { writes++; throw Error("must_not_write"); },
  } as never }, { intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
  const result = await agent.run(input);
  assert.equal(modelCalls, 1); assert.equal(reads, 1); assert.equal(writes, 0);
  assert.equal(result.safetyValidation.safe, true);
  assert.match(result.message, /70,00/);
  assert.deepEqual(result.toolsUsed, ["search_products"]);
  assert.deepEqual(result.blocks.map(block => block.type), ["product_carousel"]);
  assert.equal(JSON.stringify(result).includes("completo"), false);
  assert.equal(agent.outputReviewRequests.length, 0);
});

test("a latest corrected ceiling replaces the prior ceiling and original user/assistant history remains intact", async () => {
  const history = [{ role: "user" as const, content: "Posso gastar só R$70." },
    { role: "assistant" as const, content: "A oferta confirmada custa R$90." }];
  const before = structuredClone(history);
  const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async request => {
    const value = JSON.parse(request.messages[1]!.content!);
    assert.deepEqual(value.history, history); assert.match(value.userMessage, /95/);
    return { content: JSON.stringify(wire(9500)), usage };
  } } as never, toolHandlers: { recommendProducts: async ({ criteria }: any) => {
    assert.equal(criteria.maxPriceCents, 9500);
    return { products: [{ id: "completo", name: "Completo", price: 9000, inStock: true }],
      searchEvidence: shoppingSearchEvidence(criteria, 1) };
  } } as never }, { intent: "RECOMMEND_PERSONALIZED", requiresTool: true, needsProductDiscovery: true });
  const result = await agent.run({ ...input, history, userMessage: "Corrigindo: agora meu teto é R$95. Não inclua nada." });
  assert.match(result.message, /95,00/); assert.deepEqual(history, before);
});

test("unconfirmed or unavailable eligible pricing never falls back to base-price search or another provider", async () => {
  for (const reason of ["invalid_plan", "no_reader", "failed_reader"] as const) {
    let calls = 0, fallbackCalls = 0, legacyReads = 0;
    const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async () => {
      calls++; return { content: reason === "invalid_plan" ? " ".repeat(56) : JSON.stringify(wire(7000)), usage };
    } } as never, fallbackProvider: { chat: async () => { fallbackCalls++; throw Error("must_not_retry"); } } as never,
      toolHandlers: { searchProducts: async () => { legacyReads++; throw Error("must_not_read_base"); },
        ...(reason === "failed_reader" ? { recommendProducts: async () => { throw Error("canonical_unavailable"); } } : {}) } as never },
    { intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
    const result = await agent.run(input);
    assert.equal(calls, 1); assert.equal(fallbackCalls, 0); assert.equal(legacyReads, 0);
    assert.equal(result.message, SHOPPING_SEARCH_PLAN_UNCONFIRMED); assert.deepEqual(result.blocks, []);
  }
});

test("auxiliary lookup for writing a review remains outside the shopping planner", async () => {
  let calls = 0, lookup = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async request => {
    calls++; assert.equal(JSON.parse(request.messages[0]!.content!).id, "storefront.sales");
    return calls === 1 ? { content: "", toolCalls: [{ id: "lookup", name: "search_products", args: { query: "Produto" } }], usage }
      : { content: JSON.stringify({ schemaVersion: 1, message: "Qual comentário deseja publicar?" }), usage };
  } } as never, toolHandlers: { searchProducts: async (args: any) => {
    lookup++; assert.equal(args.lookupOnly, true);
    return { products: [{ id: "p", name: "Produto", price: 6000 }] };
  } } as never }, { domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION", requiresTool: true, needsProductDiscovery: false });
  await agent.run({ ...input, userMessage: "Quero avaliar Produto com três estrelas." });
  assert.equal(lookup, 1); assert.equal(calls, 2);
});

test("a non-discovery main call cannot activate a model-authored shopping plan through the canonical port", async () => {
  let modelCalls = 0, quotes = 0, lookups = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, provider: { chat: async () => {
    modelCalls++;
    return modelCalls === 1 ? { content: "", toolCalls: [{ id: "generated-shopping-plan", name: "search_products", args: {
      query: "Produto", criteria: shoppingSearchPlanSchema.parse({ version: 1, query: "Produto", maxPriceCents: 9500, discountOnly: true }) } }], usage }
      : { content: JSON.stringify({ schemaVersion: 1, message: "Preciso identificar os dados do produto solicitado." }), usage };
  } } as never, toolHandlers: { searchProducts: async () => { lookups++; return { products: [] }; },
    recommendProducts: async ({ criteria }: any) => { quotes++; return { products: [{ id: "different", name: "Oferta fora do lookup", price: 9000, inStock: true }],
      searchEvidence: shoppingSearchEvidence(criteria, 1) }; } } as never },
  { domain: "STORE_SUPPORT", intent: "COMPLEX_QUESTION", requiresTool: true, needsProductDiscovery: false });
  const result = await agent.run({ ...input, userMessage: "Quero avaliar Produto com três estrelas." });
  assert.equal(quotes, 0); assert.equal(lookups, 0);
  assert.equal(result.blocks.some(block => block.type === "product_carousel"), false);
});

test("rendered projected variants show the authorized effective price and retain eligible variant identity", () => {
  const criteria = shoppingSearchPlanSchema.parse({ version: 1, query: "*", maxPriceCents: 9500 });
  const result = buildConversationBlocks({ merchantId: "merchant", userMessage: "até95", finalContent: "",
    presentationMode: "structured", searchPurpose: "discovery", toolResults: { search_products: {
      products: [{ id: "p", name: "Completo", price: 9000, inStock: true,
        variants: [{ id: "v", sku: "QA", basePriceInCents: 10000, price: 9000 }] }],
      searchEvidence: shoppingSearchEvidence(criteria, 1),
    } } });
  const data = result.blocks[0]!.data as any;
  assert.equal(data.products[0].price, 9000); assert.equal(data.products[0].variants[0].price, 9000);
  assert.equal(data.products[0].variants[0].id, "v");
});
