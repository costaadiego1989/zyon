import test from "node:test";
import assert from "node:assert/strict";
import { buildCrossSellSuggestions, type CrossSellConfig } from "./cart-cross-sell.helper.js";
import { ProductEntity } from "../../../catalog/domain/entities/product.entity.js";
import { createCartHandlers } from "./cart.handlers.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { buildConversationBlocks } from "../agents/conversation-block.builder.js";
import { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import { CrossSellPromotionEntity } from "../../../cross-sell/domain/entities/cross-sell-promotion.entity.js";
import { InMemoryCrossSellPromotionRepository } from "../../../cross-sell/infrastructure/repositories/in-memory-cross-sell-promotion.repository.js";
import { InMemoryCrossSellSuggestionRepository } from "../../../cross-sell/infrastructure/repositories/in-memory-cross-sell-suggestion.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { StorefrontConversationAdapter } from "../adapters/storefront-conversation.adapter.js";

const config: CrossSellConfig = { enabled: true, touchpoints: { browsing: false, pre_cart: false, post_cart: true, pre_payment: false, post_purchase: false },
  discount: { enabled: false, mode: "percent", percent: 0 }, limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 0 }, strategies: ["complementary"] };
const cart = { sessionId: "session", total: 1000, items: [{ variantId: "source", sku: "SOURCE", name: "Cabo", unitPriceCents: 1000, quantity: 1 }] };
function fixture(overrides: Record<string, unknown> = {}) {
  const product = new ProductEntity({ id: "product", merchantId: "merchant", name: "Estojo", isActive: true, createdAt: new Date(), updatedAt: new Date(),
    variants: [ { id: "empty", sku: "EMPTY", attributes: {}, isActive: true, basePriceInCents: 2000, stockQuantity: 0, stockReserved: 0, taxPercent: 0, currency: "BRL", media: [] },
      { id: "target", sku: "TARGET", attributes: {}, isActive: true, basePriceInCents: 3000, stockQuantity: 3, stockReserved: 0, taxPercent: 0, currency: "BRL", media: [] } ] });
  const state = { ranked: ["TARGET"], discount: 0, promo: "active-rule", ambiguous: false, quoteFail: false, automaticPromo: false, writes: 0, lookups: [] as any[] };
  Object.assign(state, overrides);
  const deps: any = { productRepo: { search: async () => ({ products: [product] }), findById: async (merchant: string, id: string) => merchant === "merchant" && id === product.id ? product : null },
    merchantRepo: { getExistingRules: async () => ({ merchantId: "merchant", maxDiscountPercent: 50, minimumMarginPercent: 0 }) },
    listEligibleCrossSells: { execute: async () => [{ ranked_items: state.ranked, computed_discount: state.discount, promo_id: state.promo }] },
    prisma: { productVariant: { findMany: async (args: any) => { state.lookups.push(args); if (args.select.sku) return [{ id: "source", sku: "SOURCE", product: { categoryId: "cables" } }];
      const key = args.where.OR?.[0]?.id;
      const rows = product.variants.filter(v => v.id === key || v.sku.toLowerCase() === key?.toLowerCase()).map(v => ({ id: v.id, productId: product.id }));
      return state.ambiguous ? [...rows, { id: "duplicate", productId: "other" }] : rows; } },
      productPromotion: { findMany: async () => state.automaticPromo ? [{ id: "automatic", merchantId: "merchant", productId: product.id,
        discountType: "percent", discountValue: 10, isActive: true, startsAt: new Date(0), endsAt: new Date("2099-01-01") }] : [] },
      productPrice: { findMany: async () => { if (state.quoteFail) throw Error("price_read_failed"); return product.variants.map(v => ({ variantId: v.id, basePriceInCents: v.basePriceInCents, costInCents: 500, variant: { productId: product.id, product: { metadata: null } } })); } } } };
  const run = () => buildCrossSellSuggestions(deps, "merchant", cart, config, "Cabo");
  return { product, state, deps, run };
}

test("post-cart resolves the exact second variant, with independently confirmed price and no legacy benefit action", async () => {
  const f = fixture(); const suggestions = await f.run();
  assert.deepEqual(suggestions, [{ name: "Estojo", sku: "target", productId: "product", price: 30, imageUrl: undefined, recommendationRuleId: f.state.promo }]);
  assert.equal(f.state.writes, 0);
  const lookup = f.state.lookups.find(x => x.take === 2);
  assert.deepEqual(lookup.where.product, { merchantId: "merchant", isActive: true, deletedAt: null });
  assert.equal(lookup.where.isActive, true);
});
for (const [name, mutate] of [
  ["reserved exact stock", (f: any) => { f.product.variants[1].stockReserved = 3; }],
  ["inactive exact variant", (f: any) => { f.product.variants[1].isActive = false; }],
  ["inactive product", (f: any) => { f.product.isActive = false; }],
  ["foreign tenant", (f: any) => { f.product.merchantId = "foreign"; }],
  ["ambiguous SKU", (f: any) => { f.state.ambiguous = true; }],
  ["unknown price authority", (f: any) => { f.state.quoteFail = true; }],
  ["already carted variant", (f: any) => { f.state.ranked = ["SOURCE"]; }],
  ["legacy positive discount without quote", (f: any) => { f.state.discount = 20; }],
  ["no matching rule", (f: any) => { f.state.ranked = []; }],
] as const) test(`post-cart suppresses ${name} without substitution or writes`, async () => {
  const f = fixture(); mutate(f); assert.deepEqual(await f.run(), []); assert.equal(f.state.writes, 0);
});
test("ranked identifiers are deduplicated and catalog lookup has an explicit cost bound", async () => {
  const f = fixture({ ranked: Array.from({ length: 100 }, (_, i) => `missing-${i}`) });
  assert.deepEqual(await f.run(), []); assert.ok(f.state.lookups.length <= 21);
});

test("post-cart price uses the current authorized automatic product promotion on the exact target variant", async () => {
  const f = fixture({ automaticPromo: true });
  assert.equal((await f.run())[0]?.price, 27);
  assert.equal(f.state.writes, 0);
});

test("a current variant identifier is accepted and duplicates cannot create repeated offers", async () => {
  const f = fixture({ ranked: ["target", "TARGET", "target"] });
  assert.deepEqual((await f.run()).map(s => s.sku), ["target"]);
});

test("an individual zero-benefit rule works while the store keeps legacy discounts enabled", async () => {
  const f = fixture();
  const result = await buildCrossSellSuggestions(f.deps, "merchant", cart, { ...config, discount: { enabled: true, mode: "percent", percent: 10 } }, "Cabo");
  assert.equal(result[0]?.sku, "target");
  assert.equal(result[0]?.price, 30); assert.equal(result[0]?.promoId, undefined);
  assert.equal(result[0]?.discountPercent, undefined); assert.equal(result[0]?.couponCode, undefined);
});

test("positive legacy eligibility becomes an offer only through the connected canonical cart quote", async () => {
  const f = fixture({ discount: 10 }); let quotes = 0;
  f.deps.crossSellCart = { quote: async (scope: any, args: any) => {
    quotes++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "session" });
    assert.deepEqual(args, { variantId: "target", promotionId: "active-rule", quantity: 1 });
    return { ...scope, variantId: "target", productId: "product", promotionId: "active-rule", originalUnitPriceCents: 3000, maximumUnitPriceCents: 2700 };
  } };
  const result = await f.run();
  assert.equal(quotes, 1); assert.equal(result[0]?.price, 27); assert.equal(result[0]?.discountPercent, 10);
  assert.equal(result[0]?.promoId, "active-rule"); assert.equal(result[0]?.recommendationRuleId, undefined); assert.equal(f.state.writes, 0);
});
test("internal post-accept hook reuses the real post-cart configuration, exact cart line and shared helper without a cart writer", async () => {
  const f = fixture(); let projections = 0;
  const hook = { handlerDeps: f.deps, loadCrossSellConfig: async () => config, crossSellCart: {
    project: async (scope: any) => { projections++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "session" }); return { ...cart, merchantId: "merchant" }; },
  } };
  const result = await StorefrontConversationAdapter.prototype.postCartSuggestions.call(hook as any, { merchantId: "merchant", cartId: "session", addedVariantId: "source" });
  assert.equal(result?.data.products[0]?.id, "target"); assert.equal(result?.data.products[0]?.recommendationRuleId, "active-rule");
  assert.equal(projections, 1); assert.equal(f.state.writes, 0);
  assert.equal(await StorefrontConversationAdapter.prototype.postCartSuggestions.call(hook as any, { merchantId: "merchant", cartId: "session", addedVariantId: "missing" }), undefined);
  hook.loadCrossSellConfig = async () => ({ ...config, touchpoints: { ...config.touchpoints, post_cart: false } });
  const before = projections;
  assert.equal(await StorefrontConversationAdapter.prototype.postCartSuggestions.call(hook as any, { merchantId: "merchant", cartId: "session", addedVariantId: "source" }), undefined);
  assert.equal(projections, before);
});
for (const changed of ["unknown", "same-price", "foreign-merchant", "foreign-cart", "other-variant", "other-product", "other-rule"] as const)
  test(`positive recommendation has no fallback to a promised percentage when quote is ${changed}`, async () => {
    const f = fixture({ discount: 10 });
    f.deps.crossSellCart = { quote: async () => {
      if (changed === "unknown") throw Error("authority unknown");
      return { merchantId: changed === "foreign-merchant" ? "other" : "merchant", cartId: changed === "foreign-cart" ? "other" : "session",
        variantId: changed === "other-variant" ? "other" : "target", productId: changed === "other-product" ? "other" : "product",
        promotionId: changed === "other-rule" ? "other" : "active-rule", originalUnitPriceCents: 3000, maximumUnitPriceCents: changed === "same-price" ? 3000 : 2700 };
    } };
    assert.deepEqual(await f.run(), []); assert.equal(f.state.writes, 0);
  });

test("a real active manual rule produces a scoped complementary variant through the shared use case and canonical quote", async () => {
  const f = fixture(); const rules = new InMemoryCrossSellPromotionRepository();
  const promotion = CrossSellPromotionEntity.create({ merchant_id: "merchant", name: "Cabo e estojo", trigger: { sku_in_cart: ["SOURCE"] },
    recommended_skus: ["TARGET"], discount_percent: 0, max_discount_percent: 0, starts_at: new Date(0) });
  await rules.save(promotion);
  f.deps.listEligibleCrossSells = new ListEligibleCrossSellsUseCase(rules, new InMemoryCrossSellSuggestionRepository(), new InMemoryOutboxRepository());
  assert.equal((await f.run())[0]?.sku, "target");
  await rules.save(promotion.archive()); assert.deepEqual(await f.run(), []);
});

function realAddFixture(existingLineForAdd?: import("../../domain/ports/storefront-cart.port.js").StorefrontExistingCartLine) {
  const f = fixture();
  const source = new ProductEntity({ id: "source-product", merchantId: "merchant", name: "Cabo", isActive: true,
    createdAt: new Date(), updatedAt: new Date(), variants: [{ ...f.product.variants[1], id: "source", sku: "SOURCE", basePriceInCents: 1000 }] });
  let saved: any = { id: "cart", merchantId: "merchant", sessionId: "session", items: [], total: 0, discount: 0, couponCode: null,
    freeShipping: false, createdAt: new Date(), updatedAt: new Date() };
  const state = { writes: 0, evaluations: 0, enabled: true, postCart: true, stock: 10, engineError: false, preconditions: [] as unknown[] };
  f.deps.productRepo.findById = async (_merchant: string, id: string) => id === source.id ? source : id === f.product.id ? f.product : null;
  f.deps.prisma.productVariant.findFirst = async () => ({ productId: source.id });
  const originalPriceRead = f.deps.prisma.productPrice.findMany;
  f.deps.prisma.productPrice.findMany = async (args: any) => [...await originalPriceRead(args), { variantId: "source", basePriceInCents: 1000,
    costInCents: 500, variant: { productId: source.id, product: { metadata: null } } }];
  f.deps.prisma.checkoutSetting = { findUnique: async () => ({ advancedRules: [] }) };
  f.deps.stockRepo = { getAvailableStock: async () => ({ quantity: state.stock, reserved: 0 }) };
  f.deps.cartRepo = { getOrCreate: async () => structuredClone(saved), addItem: async (_merchant: string, _session: string, item: any, expected?: unknown) => {
    state.preconditions.push(expected);
    state.writes++; const existing = saved.items.find((line: any) => line.variantId === item.variantId);
    if (existing) existing.quantity += item.quantity; else saved.items.push(item);
    saved.total = saved.items.reduce((sum: number, line: any) => sum + line.quantity * line.unitPriceCents, 0);
    return structuredClone(saved);
  } };
  f.deps.loadCrossSellConfig = async () => ({ ...config, enabled: state.enabled, touchpoints: { ...config.touchpoints, post_cart: state.postCart } });
  const originalEligible = f.deps.listEligibleCrossSells.execute;
  f.deps.listEligibleCrossSells.execute = async (...args: any[]) => { state.evaluations++; if (state.engineError) throw Error("recommendation_unavailable"); return originalEligible(...args); };
  const handlers = createCartHandlers(f.deps, { merchantId: "merchant", sessionId: "session", existingLineForAdd });
  const add = () => callStorefrontTool("add_item_to_cart", { cartId: "session", variantId: "source", quantity: 1 },
    args => handlers.addItemToCart(args as any), { cartId: "session" });
  return { add, state, handlers };
}

test("normal ADD forwards a precondition only from the internal server context, never a model argument", async () => {
  const expected = { variantId: "source", quantity: 1, unitPriceCents: 1000 };
  const admitted = realAddFixture(expected); await admitted.add(); assert.deepEqual(admitted.state.preconditions, [expected]);
  const normal = realAddFixture(); await normal.add(); assert.deepEqual(normal.state.preconditions, [undefined]);
  const rejected = realAddFixture();
  const checked = await callStorefrontTool("add_item_to_cart", { cartId: "session", variantId: "source", quantity: 1, existingLineForAdd: expected },
    args => rejected.handlers.addItemToCart(args as any), { cartId: "session" });
  assert.equal(checked.ok, false); assert.equal(rejected.state.writes, 0); assert.equal(rejected.state.preconditions.length, 0);
});

test("the real NLP tool/handler evaluates post-cart after every confirmed add and builds a public offer", async () => {
  const f = realAddFixture();
  for (let i = 0; i < 2; i++) {
    const added = await f.add(); assert.equal(added.ok, true); if (!added.ok) return;
    const blocks = buildConversationBlocks({ toolResults: { add_item_to_cart: added.data }, userMessage: "Adicione o cabo", finalContent: "Adicionado", merchantId: "merchant", presentationMode: "structured" }).blocks;
    assert.equal(blocks.find(block => block.type === "cross_sell")?.data.products[0]?.id, "target");
  }
  assert.equal(f.state.writes, 2); assert.equal(f.state.evaluations, 2);
  f.state.stock = 0; await f.add(); assert.equal(f.state.writes, 2); assert.equal(f.state.evaluations, 2);
});
for (const mode of ["disabled", "post-cart disabled", "engine unavailable"]) test(`${mode} never blocks or repeats a successful add`, async () => {
  const f = realAddFixture();
  if (mode === "disabled") f.state.enabled = false;
  if (mode === "post-cart disabled") f.state.postCart = false;
  if (mode === "engine unavailable") f.state.engineError = true;
  const added = await f.add(); assert.equal(added.ok, true); assert.equal(f.state.writes, 1);
  if (added.ok) assert.equal((added.data as any).crossSellSuggestions, undefined);
});
