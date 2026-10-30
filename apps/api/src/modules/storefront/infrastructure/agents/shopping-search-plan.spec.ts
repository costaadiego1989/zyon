import test from "node:test";
import assert from "node:assert/strict";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { storefrontToolArgumentSchemas } from "../../domain/contracts/storefront-tool.schemas.js";
import { storefrontToolOutputSchemas } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";
import { createProductHandlers } from "../tool-handlers/product.handlers.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";
import { createAllowedScopeAgent as createScopeAgent } from "./storefront-scope.fixture.js";
import { STOREFRONT_CONTRACT_FALLBACK } from "../../domain/contracts/storefront-conversation.schemas.js";
import { createSalesSearchPolicy } from "../../domain/services/sales-search-policy.js";
import { buildMetaUiView } from "../../../whatsapp-channel/domain/ui/meta-ui-renderer.js";
import { executeStorefrontUiAction } from "./storefront-ui-action.executor.js";
import { conversationBlockSchema } from "../../domain/contracts/conversation-block.schemas.js";
import { ensureProductDiscovery } from "./product-discovery-fallback.js";
import { SHOPPING_SEARCH_PLAN_UNCONFIRMED } from "../../domain/contracts/shopping-search-plan.schemas.js";
import { createShoppingRecommendationReader } from "../tool-handlers/shopping-recommendation.handler.js";

const createAllowedScopeAgent = (deps: Parameters<typeof createScopeAgent>[0]) => createScopeAgent(deps, { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
const base = { merchantId: "merchant-a", sessionId: "cart-a", userMessage: "Mostre produtos entre 50 e 100 reais. Não altere meu carrinho." };
const plan = (extra: Record<string, unknown> = {}) => shoppingSearchPlanSchema.parse({ version: 1, query: "*", ...extra });
const handlersWith = (search: (args: any) => Promise<any>, extra: any = {}) => createProductHandlers({
  productRepo: { search }, prisma: { checkoutSetting: { findUnique: async () => null } }, ...extra,
} as never, base);

test("variable criteria validate units, rating, contradictory predicates and scope before any tool runs", () => {
  const valid = plan({ minPriceCents: 5000, maxPriceCents: 10000, minRating: 4,
    attributes: [{ name: "material", value: "algodão", operator: "equals", priority: "required" }] });
  assert.equal(storefrontToolArgumentSchemas.search_products.safeParse({ query: "*", criteria: valid }).success, true);
  for (const extra of [
    { minPriceCents: 10001, maxPriceCents: 10000 }, { minPriceCents: 0.5 }, { maxPriceCents: -1 },
    { minRating: 6 }, { merchantId: "merchant-b" }, { cypher: "MATCH (n) DETACH DELETE n" },
    { attributes: [{ name: "cor", value: "azul", operator: "equals", priority: "required" },
      { name: "COR", value: "azul", operator: "not_equals", priority: "required" }] },
  ]) assert.equal(shoppingSearchPlanSchema.safeParse({ version: 1, query: "*", ...extra }).success, false);
});

test("shared handler sends independent criteria to the canonical repository without lexical cart instructions", async () => {
  const calls: any[] = [];
  const criteria = plan({ minPriceCents: 5000, maxPriceCents: 10000, minRating: 4, sortBy: "price_asc",
    attributes: [
      { name: "material", value: "algodão", operator: "equals", priority: "required" },
      { name: "cor", value: "verde", operator: "equals", priority: "preferred" },
    ] });
  const result: any = await handlersWith(async args => { calls.push(args); return { products: [], total: 0 }; })
    .searchProducts({ query: "Do not search these operational instructions", criteria });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { merchantId: "merchant-a", query: "*", queryMode: undefined, categoryId: undefined,
    minPriceCents: 5000, maxPriceCents: 10000, minRating: 4, sortBy: "price_asc", currency: "BRL", inStockOnly: true,
    attributes: [{ name: "material", value: "algodão", operator: "equals" }], isActiveOnly: true, cursor: undefined, limit: 10 });
  assert.equal(result.searchEvidence.status, "verified");
  assert.match(result.searchEvidence.message, /50,00.*100,00/);
  assert.match(result.searchEvidence.message, /sem avaliações aprovadas/);
  assert.match(result.searchEvidence.message, /Preferências ainda não confirmadas: cor: verde/);
  assert.equal(storefrontToolOutputSchemas.search_products.safeParse(result).success, true);
});

test("unknown requirements and delivery requirements never execute a relaxed search or expose purported matches", async () => {
  let reads = 0;
  const handlers = handlersWith(async () => { reads++; throw Error("must_not_search"); });
  for (const criteria of [
    plan({ unsupportedCriteria: ["mais vendidos", "total com frete"] }),
    plan({ delivery: { freeOnly: true } }),
    plan({ delivery: { maxPriceCents: 800, zipCode: "20000000" } }),
  ]) {
    const result: any = await handlers.searchProducts({ query: "*", criteria });
    assert.deepEqual(result.products, []);
    assert.notEqual(result.searchEvidence.status, "verified");
    assert.match(result.searchEvidence.message, /não consigo|preciso do CEP/);
  }
  for (const sortBy of ["best_sellers", "discount"] as const) {
    const result: any = await handlers.searchProducts({ query: "*", sortBy });
    assert.equal(result.searchEvidence.status, "unsupported");
  }
  assert.equal(reads, 0);
});

test("delivery limitations and quoted unsupported commercial criteria survive the actual message guard without granting benefits", async () => {
  for (const criteria of [plan({ delivery: { freeOnly: true, zipCode: "20000000" } }),
    plan({ unsupportedCriteria: ["desconto de 50% e frete grátis"] })]) {
    let reads = 0;
    const canonical = handlersWith(async () => { reads++; throw Error("must_not_read"); });
    const agent = createAllowedScopeAgent({ provider: { chat: async () => ({ content: "", usage,
      toolCalls: [{ id: "criteria", name: "search_products", args: { query: "*", criteria } }],
    }) } as never, toolHandlers: canonical as never });
    const result = await agent.run({ ...base, history: [], cartId: "cart-a", userMessage: "Procure produtos com meus critérios" });
    assert.equal(reads, 0);
    assert.equal(result.safetyValidation.safe, true);
    assert.match(result.message, /não consigo|Não consigo/);
    assert.deepEqual(result.blocks, []);
    assert.equal(agent.outputReviewRequests.length, 0);
  }
});

test("criteria do not fall through to marketplace products that cannot prove every local filter", async () => {
  let partners = 0;
  const result: any = await handlersWith(async () => ({ products: [], total: 0 }), {
    searchFederatedProducts: { execute: async () => { partners++; return { products: [] }; } },
  }).searchProducts({ query: "tênis", criteria: plan({ query: "tênis", minRating: 4.5 }) });
  assert.equal(partners, 0);
  assert.deepEqual(result.products, []);
});

test("canonical evidence prevails over both malformed narration and fluent unsupported commerce claims", () => {
  for (const finalContent of [STOREFRONT_CONTRACT_FALLBACK, "Todos têm frete grátis e cinco estrelas!"]) {
    const criteria = plan({ delivery: { freeOnly: true } });
    const searchEvidence = shoppingSearchEvidence(criteria, 0);
    const result = buildConversationBlocks({ merchantId: "merchant-a", userMessage: "quero frete grátis", finalContent,
      toolResults: { search_products: { products: [], searchEvidence } } });
    assert.equal(result.finalContent, searchEvidence.message);
    assert.equal(result.canonicalReadMessage, true);
    assert.deepEqual(result.blocks, []);
  }
  const result = buildConversationBlocks({ merchantId: "merchant-a", userMessage: "mostre produtos", finalContent: STOREFRONT_CONTRACT_FALLBACK,
    toolResults: { search_products: { products: [] } } });
  assert.match(result.finalContent, /Não encontrei produtos/);
  const unknownWrite = buildConversationBlocks({ merchantId: "merchant-a", userMessage: "mostre produtos", finalContent: STOREFRONT_CONTRACT_FALLBACK,
    toolResults: { search_products: { products: [], searchEvidence: shoppingSearchEvidence(plan(), 0) },
      apply_coupon: { error: "storefront_tool_outcome_unknown" } } });
  assert.equal(unknownWrite.finalContent, STOREFRONT_CONTRACT_FALLBACK);
});

test("empty reviews receive a specific confirmed response; failed reads retain the refusal", () => {
  const input = { merchantId: "merchant-a", userMessage: "avaliações positivas", finalContent: STOREFRONT_CONTRACT_FALLBACK };
  const result = buildConversationBlocks({ ...input, toolResults: { get_reviews: { reviews: [], totalCount: 0, averageRating: 0 } } });
  assert.match(result.finalContent, /Não há avaliações publicadas/);
  assert.equal(buildConversationBlocks({ ...input, toolResults: { get_reviews: { error: "provider_failed" } } }).finalContent, STOREFRONT_CONTRACT_FALLBACK);
});

test("sales synonym policy preserves the typed criteria plan without rebuilding its product query", async () => {
  const criteria = plan({ query: "hidratante", maxPriceCents: 8000,
    attributes: [{ name: "fragrância", value: "sem perfume", operator: "equals", priority: "required" }] });
  let calls = 0;
  const [tool] = createSalesSearchPolicy("Quero hidratante para pele oleosa até 80 reais sem perfume", []).wrap([
    { name: "search_products", execute: async args => { calls++; assert.deepEqual(args, { query: "hidratante", criteria }); return { ok: true, data: { products: [] } }; } },
  ]);
  await tool.execute({ query: "hidratante", criteria });
  assert.equal(calls, 1);
});

test("catalog pagination carries the same typed filters through block validation, native WhatsApp and the UI executor", async () => {
  const criteria = plan({ minPriceCents: 5000, maxPriceCents: 10000, minRating: 4, sortBy: "price_asc" });
  const built = buildConversationBlocks({ merchantId: "merchant-a", userMessage: "produtos até 100", finalContent: "",
    toolResults: { search_products: { products: [{ id: "p", name: "Produto", price: 8000, inStock: true }], nextCursor: "cursor-p",
      query: "*", searchEvidence: shoppingSearchEvidence(criteria, 1) } } });
  const blocks = built.blocks.map(block => conversationBlockSchema.parse(block));
  const view = buildMetaUiView({ agentMessage: built.finalContent, merchantName: "Loja", quickReplies: [], blocks,
    state: { version: 1, conversationId: "owned", stage: "store", history: [], revision: "current", page: 0, previousViews: [] } } as never);
  const next = view.choices.find(choice => choice.label === "Mais produtos");
  assert.equal(next?.action.kind, "tool");
  assert.deepEqual((next?.action as any).args.criteria, criteria);
  const calls: any[] = [];
  const result = await executeStorefrontUiAction({ recommendProducts: async args => { calls.push(args); return {
    products: [], query: "*", searchEvidence: shoppingSearchEvidence(criteria, 0),
  }; }, searchProducts: async () => { throw Error("base-price shortcut forbidden"); } } as never,
  { tool: "search_products", args: (next?.action as any).args }, "merchant-a", "cart-a");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].criteria, criteria);
  assert.equal(calls[0].cursor, "cursor-p");
  assert.match(result.message, /50,00.*100,00/);
});

test("review pagination preserves the chosen positive/negative filter through validated blocks and UI reads", async () => {
  for (const filter of ["positive", "negative"] as const) {
    const payload = { productId: "p", productName: "Produto", reviews: [{ id: "review:r", author: "QA", rating: 4,
      text: "Teste", date: "2026-10-29" }], nextCursor: "review:r", totalCount: 2, averageRating: 4, filter };
    const built = buildConversationBlocks({ merchantId: "merchant-a", userMessage: "avaliações", finalContent: STOREFRONT_CONTRACT_FALLBACK,
      toolResults: { get_reviews: payload } });
    const block = built.blocks.find(item => item.type === "reviews");
    assert.equal(conversationBlockSchema.safeParse(block).success, true);
    assert.equal((block?.data as any).filter, filter);
    assert.match(built.finalContent, /avaliações publicadas/);
    const calls: any[] = [];
    await executeStorefrontUiAction({ getReviews: async args => { calls.push(args); return payload; } } as never,
      { tool: "get_reviews", args: { productId: "p", cursor: "review:r", filter } }, "merchant-a", "cart-a");
    assert.equal(calls[0].filter, filter);
  }
});

test("real tool loop carries LLM JSON plan through the shared handler and terminates on canonical facts before any relaxed second search", async () => {
  for (const messageFormat of [undefined, "whatsapp"] as const) {
    const calls: any[] = [];
    const criteria = plan({ minPriceCents: 5000, maxPriceCents: 10000, minRating: 4, sortBy: "newest" });
    let modelCalls = 0, writes = 0;
    const canonical = handlersWith(async args => { calls.push(args); return { products: [], total: 0 }; });
    const recommendProducts = createShoppingRecommendationReader({ merchantRepo: { getExistingRules: async () => ({ maxDiscountPercent: 10, minimumMarginPercent: 0 }) },
      prisma: { productPromotion: { findMany: async () => [] } } } as never, base, canonical.searchProducts);
    const agent = createAllowedScopeAgent({ provider: { chat: async (request: any) => {
      assert.match(request.messages[0].content, /PLANO DE CONSULTA/);
      const tool = request.tools?.find((item: any) => item.function.name === "search_products");
      assert.ok(tool?.function.parameters.properties.criteria);
      return ++modelCalls === 1
        ? { content: "", toolCalls: [{ id: "read", name: "search_products", args: { query: "*", criteria } },
          { id: "discarded-relaxation", name: "search_products", args: { query: "*" } }], usage }
        : { content: "PRIVATE_UNSTRUCTURED_MODEL_PROSE", usage };
    } } as never, toolHandlers: { ...canonical, recommendProducts, addItemToCart: async () => { writes++; throw Error("write_forbidden"); } } as never });
    const result = await agent.run({ ...base, cartId: "cart-a", history: [], messageFormat });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].maxPriceCents, undefined); // Candidates precede canonical promotional pricing.
    assert.equal(modelCalls, 1);
    assert.equal(writes, 0);
    assert.equal(agent.outputReviewRequests.length, 0);
    assert.match(result.message, /Não encontrei produtos disponíveis/);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_UNSTRUCTURED_MODEL_PROSE"));
    assert.deepEqual(result.toolsUsed, ["search_products"]);
  }
});

test("structured discovery independently plans delivery requirements before any lexical search or narration", async () => {
  let calls = 0, reads = 0;
  const canonical = handlersWith(async () => { reads++; throw Error("shipping_capability_is_not_a_lexical_search"); });
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: canonical as never,
    provider: { chat: async (request: any) => {
      calls++;
      assert.equal(JSON.parse(request.messages[0].content).id, "storefront.shopping-plan");
      assert.equal(request.tools, undefined);
      return { content: JSON.stringify({ schemaVersion: 1, plan: { version: 1, query: "*", minPriceCents: null,
        maxPriceCents: null, minRating: null, attributes: [], sortBy: null,
        delivery: { freeOnly: true, zipCode: "20040020" }, unsupportedCriteria: [] } }), usage };
    } } as never });
  const result = await agent.run({ ...base, userMessage: "Mostre produtos com frete grátis para o CEP 20040-020", history: [] });
  assert.equal(calls, 1); assert.equal(reads, 0);
  assert.match(result.message, /não consigo verificar frete por produto/);
  assert.equal(result.safetyValidation.safe, true);
  assert.equal(result.routing.structuredSearchRequired, true);
});

test("missing structured plans never claim zero matches or trigger a legacy catalog fallback", async () => {
  for (const callTool of [false, true]) {
    let reads = 0;
    const canonical = handlersWith(async () => { reads++; throw Error("unplanned_search_forbidden"); });
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: canonical as never,
      provider: { chat: async () => callTool
        ? { content: "", toolCalls: [{ id: "missing-plan", name: "search_products", args: { query: "frete grátis" } }], usage }
        : { content: JSON.stringify({ schemaVersion: 1, message: "Não encontrei produtos correspondentes." }), usage } } as never });
    const input = { ...base, userMessage: "Mostre produtos com frete grátis para o CEP 20040-020", history: [] };
    const result = await agent.run(input);
    const final = await ensureProductDiscovery(result, { ...input, handlers: canonical as never,
      discoveryDecision: result.routing.needsProductDiscovery, structuredSearchRequired: result.routing.structuredSearchRequired });
    assert.equal(reads, 0); assert.equal(final.message, SHOPPING_SEARCH_PLAN_UNCONFIRMED);
    assert.deepEqual(final.blocks, []);
  }
});
