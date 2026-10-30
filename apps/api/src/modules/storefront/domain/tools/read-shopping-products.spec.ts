import test from "node:test";
import assert from "node:assert/strict";
import { readShoppingProducts, requiresCanonicalShoppingRead } from "./read-shopping-products.js";
import { shoppingSearchPlanSchema } from "../contracts/shopping-search-plan.schemas.js";
import { shoppingSearchEvidence } from "../../application/services/shopping-search-evidence.js";
import { executeStorefrontUiAction } from "../../infrastructure/agents/storefront-ui-action.executor.js";
import { createAllowedScopeAgent } from "../../infrastructure/agents/storefront-scope.fixture.js";
import { createSearchProductsTool } from "./definitions/search-products.tool.js";
import { storefrontConversationOutputSchema, STOREFRONT_CONTRACT_FALLBACK } from "../contracts/storefront-conversation.schemas.js";
import { storefrontPublicReadUiActionRequestSchema } from "../contracts/storefront-public-read-ui-action.schemas.js";
import { createProductHandlers } from "../../infrastructure/tool-handlers/product.handlers.js";
import { SHOPPING_SEARCH_PLAN_UNCONFIRMED } from "../contracts/shopping-search-plan.schemas.js";
import { storefrontToolArgumentSchemas } from "../contracts/storefront-tool.schemas.js";

const plan = (extra: Record<string, unknown> = {}) => shoppingSearchPlanSchema.parse({ version: 1, query: "*", discountOnly: true, ...extra });
function fixture(options: { missing?: boolean; error?: boolean } = {}) {
  const calls: any[] = []; let baseReads = 0;
  const handlers = { searchProducts: async () => { baseReads++; return { products: [{ id: "plain", name: "Sem promoção", price: 6000, inStock: true }] }; },
    ...(!options.missing ? { recommendProducts: async (args: any) => {
      calls.push(args); if (options.error) throw Error("pricing unavailable");
      return { products: [{ id: "complete", name: "Completo", price: 9000, originalPrice: 10000, discountPercent: 10, inStock: true,
        variants: [{ id: "v100", basePriceInCents: 10000, price: 9000 }] }], nextCursor: null,
        categoryId: args.categoryId, searchEvidence: shoppingSearchEvidence(args.criteria, 1) };
    } } : {}) };
  return { handlers, calls, baseReads: () => baseReads };
}

test("the typed flag admits canonical reading with no price interval; false never means an inverse filter", async () => {
  const f = fixture(); assert.equal(requiresCanonicalShoppingRead(plan()), true);
  const result: any = await readShoppingProducts(f.handlers as never, { query: "*", criteria: plan() });
  assert.equal(result.products[0].price, 9000); assert.equal(f.calls.length, 1); assert.equal(f.baseReads(), 0);
  assert.equal(requiresCanonicalShoppingRead(plan({ discountOnly: false })), false);
  const plain: any = await readShoppingProducts(f.handlers as never, { query: "*", criteria: plan({ discountOnly: false }) });
  assert.equal(plain.products[0].id, "plain"); assert.equal(f.baseReads(), 1);
});

test("native model search and UI shortcut share canonical admission and preserve category/cursor", async () => {
  const f = fixture(), criteria = plan();
  const tool = createSearchProductsTool({ handlers: f.handlers } as never);
  const native = await tool.execute({ query: "*", criteria }); assert.equal(native.ok, true);
  const ui = await executeStorefrontUiAction(f.handlers as never, { tool: "search_products", args: {
    query: "*", criteria, categoryId: "owned-category", cursor: "page-2" } }, "merchant", "cart");
  assert.equal(f.baseReads(), 0); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].categoryId, "owned-category"); assert.equal(f.calls[1].cursor, "page-2");
  assert.match(ui.message, /promoção/); const data = ui.blocks[0]!.data as any;
  assert.equal(data.products[0].price, 9000); assert.equal(data.products[0].variants[0].price, 9000);
  assert.equal(data.products[0].originalPrice, 10000); assert.equal(data.products[0].discountPercent, 10);
  assert.equal(data.criteria.discountOnly, true); assert.equal(data.categoryId, "owned-category");
});

for (const options of [{ missing: true }, { error: true }]) test(`UI cannot fall back to base products when canonical discount evidence is unavailable: ${JSON.stringify(options)}`, async () => {
  const f = fixture(options);
  const ui = await executeStorefrontUiAction(f.handlers as never, { tool: "search_products", args: { query: "*", criteria: plan() } }, "merchant", "cart");
  assert.equal(f.baseReads(), 0); assert.equal(ui.message, STOREFRONT_CONTRACT_FALLBACK); assert.deepEqual(ui.blocks, []);
});

for (const messageFormat of [undefined, "whatsapp"] as const) test(`PRODUCT_SEARCH plans current discounts independently of a budget and projects the canonical price (${messageFormat ?? "web"})`, async () => {
  const f = fixture(); let calls = 0;
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: f.handlers as never, provider: { chat: async () => {
    calls++; return { content: JSON.stringify({ schemaVersion: 1, plan: { ...plan(), minPriceCents: null, maxPriceCents: null,
      minRating: null, sortBy: null, delivery: null } }), usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  } } as never }, { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
  const result = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [],
    userMessage: "Quais produtos estão com desconto?", messageFormat });
  assert.equal(calls, 1); assert.equal(f.baseReads(), 0); assert.equal(f.calls.length, 1);
  assert.equal(result.safetyValidation.safe, true); assert.match(result.message, /promoção/);
  assert.deepEqual(result.toolsUsed, ["search_products"]);
  assert.equal(storefrontConversationOutputSchema.safeParse({ message: result.message, blocks: result.blocks, cartId: "cart", suggestedNext: [] }).success, true);
  const product = (result.blocks[0]!.data as any).products[0]; assert.equal(product.price, 9000); assert.equal(product.variants[0].price, 9000);
  assert.equal(product.originalPrice, 10000); assert.equal(product.discountPercent, 10);
});

test("raw candidate search cannot assert the discount criterion even when lookupOnly is injected", async () => {
  let reads = 0; const raw = createProductHandlers({ productRepo: { search: async () => { reads++; throw Error("must not read"); } } } as never,
    { merchantId: "merchant", sessionId: "cart" });
  for (const lookupOnly of [false, true]) {
    const out: any = await raw.searchProducts({ query: "*", criteria: plan(), lookupOnly });
    assert.deepEqual(out.products, []); assert.equal(out.searchEvidence.status, "unsupported");
    assert.doesNotMatch(out.searchEvidence.message, /não encontrei/i);
  }
  assert.equal(reads, 0);
});

test("public category actions remain narrow and reject submitted criteria rather than gaining a discount capability", () => {
  assert.equal(storefrontPublicReadUiActionRequestSchema.safeParse({ ui_action_version: 1, user_message: "Ofertas",
    ui_action: { tool: "search_products", args: { query: "*", categoryId: "category", criteria: plan() } } }).success, false);
});

test("biggest-discount ranking remains explicitly unsupported and does not execute either reader", async () => {
  const f = fixture(); const out: any = await readShoppingProducts(f.handlers as never, { query: "*", criteria: plan(), sortBy: "discount" });
  assert.deepEqual(out.products, []); assert.equal(out.searchEvidence.status, "unsupported");
  assert.match(out.searchEvidence.message, /maior desconto/); assert.equal(out.searchEvidence.appliedPlan.discountOnly, true);
  assert.equal(f.calls.length, 0); assert.equal(f.baseReads(), 0);
});

test("a provider replay of inverse false fails planning before either reader can return a general catalog", async () => {
  const f = fixture();
  const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: f.handlers as never, provider: { chat: async () => ({
    content: JSON.stringify({ schemaVersion: 1, plan: { ...plan({ discountOnly: false }), minPriceCents: null, maxPriceCents: null,
      minRating: null, sortBy: null, delivery: null } }), usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
  } as never }, { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
  const out = await agent.run({ merchantId: "merchant", sessionId: "cart", cartId: "cart", history: [],
    userMessage: "Mostre somente produtos que não estão com desconto." });
  assert.equal(f.calls.length, 0); assert.equal(f.baseReads(), 0); assert.equal(out.message, SHOPPING_SEARCH_PLAN_UNCONFIRMED);
  assert.deepEqual(out.blocks, []);
});

test("only an internal lookup capability preserves a valid typed name lookup without commercial filtering", async () => {
  const calls: any[] = []; let quotes = 0;
  const criteria = plan({ query: "Produto", discountOnly: false, minRating: 3, minPriceCents: 500, maxPriceCents: 3000 });
  const handlers = { shoppingReadMode: "lookup_only" as const,
    searchProducts: async (args: any) => { calls.push(args); return { products: [] }; },
    recommendProducts: async () => { quotes++; throw Error("commercial discovery forbidden"); } };
  await readShoppingProducts(handlers as never, { query: "Produto", criteria });
  assert.equal(quotes, 0); assert.equal(calls.length, 1); assert.equal(calls[0].lookupOnly, true);
  assert.deepEqual(calls[0].criteria, criteria);
  await assert.rejects(readShoppingProducts(handlers as never, { query: "Produto", criteria: plan({ query: "Produto" }) }));
  assert.equal(quotes, 0); assert.equal(calls.length, 1); // discountOnly=true grants neither lookup nor quote.
});

test("a client/model cannot submit the handler capability and handlers without it still require canonical authority", async () => {
  const criteria = plan({ discountOnly: false, maxPriceCents: 3000 }); let lookups = 0;
  const handlers = { searchProducts: async () => { lookups++; return { products: [] }; } };
  assert.equal(storefrontToolArgumentSchemas.search_products.safeParse({ query: "Produto", criteria, shoppingReadMode: "lookup_only" }).success, false);
  assert.equal(shoppingSearchPlanSchema.safeParse({ ...criteria, shoppingReadMode: "lookup_only" }).success, false);
  await assert.rejects(readShoppingProducts(handlers as never,
    { query: "Produto", criteria, shoppingReadMode: "lookup_only" } as never));
  assert.equal(lookups, 0);
});
