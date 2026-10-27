import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { CatalogStrategyRecommenderPort } from "../../../cross-sell/domain/ports/catalog-strategy.port.js";
import type { CrossSellCoOccurrencePort } from "../../../cross-sell/domain/ports/co-occurrence.port.js";
import type { CrossSellPreviewStrategiesPort } from "../../../cross-sell/domain/ports/preview-strategies.port.js";
import { PublicProductCrossSellPreview } from "./public-product-cross-sell-preview.js";

const settings = (strategies: string[] = ["same_category"], max = 2) => ({ crossSell: {
  enabled: true, touchpoints: { pre_cart: true }, strategies,
  limits: { maxSuggestionsPerSession: max }, display: { mode: "modal" },
} });
const variant = (sku: string, price = 2500, quantity = 5, reserved = 0, type = "physical") => ({
  id: `variant_${sku}`, productId: `product_${sku}`, sku, price: { basePriceInCents: price }, media: [{ url: `https://example.test/${sku}.jpg` }],
  stock: [{ quantity, reserved }], product: { name: `Product ${sku}`, type },
});
type Variant = ReturnType<typeof variant>;
type Promotion = { id: string; trigger: unknown; recommendedSkus: string[]; discountPercent: number };
type Query = { where: { merchantId?: string; status?: string; startsAt?: { lte: Date }; OR?: unknown[];
  sku?: { in: string[] }; isActive?: boolean; product?: { merchantId: string; isActive: boolean; deletedAt: null } } };

function harness(t: TestContext, options: {
  merchantId?: string; promotions?: Promotion[]; variants?: Variant[]; skus?: string[]; viewedPrice?: number | null;
  failure?: "promotions" | "resolve" | "viewed" | "strategy";
} = {}) {
  const merchantId = options.merchantId ?? "merchant_preview";
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const reads: Array<{ method: string; query: Query }> = [];
  const unexpected: string[] = [];
  const catalogInstances: CatalogStrategyRecommenderPort[] = [];
  const coOccurrenceInstances: CrossSellCoOccurrencePort[] = [];
  const readOnly = <T extends object>(target: T, label: string): T => new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "string" && !Object.hasOwn(object, property)) {
        unexpected.push(`${label}.${property}`);
        throw new Error("Unexpected read or write on public product preview");
      }
      return Reflect.get(object, property, receiver);
    },
  });
  const prisma = readOnly({
    crossSellPromotion: readOnly({ async findMany(query: Query) {
      reads.push({ method: "promotions", query });
      if (options.failure === "promotions") throw new Error("synthetic_promotion_read_failure");
      return options.promotions ?? [];
    } }, "crossSellPromotion"),
    productVariant: readOnly({
      async findMany(query: Query) {
        reads.push({ method: "resolve", query });
        if (options.failure === "resolve") throw new Error("synthetic_variant_read_failure");
        return (options.variants ?? [variant("COMPANION")]).filter(row => query.where.sku?.in.includes(row.sku));
      },
      async findFirst(query: Query) {
        reads.push({ method: "viewed", query });
        if (options.failure === "viewed") throw new Error("synthetic_viewed_read_failure");
        return options.viewedPrice === null ? null : { price: { basePriceInCents: options.viewedPrice ?? 12990 } };
      },
    }, "productVariant"),
  }, "prisma") as unknown as PrismaClient;
  const recommend = async (method: string, args: unknown[]) => {
    calls.push({ method, args });
    if (options.failure === "strategy") throw new Error("synthetic_strategy_failure");
    return options.skus ?? ["COMPANION"];
  };
  const catalog: CatalogStrategyRecommenderPort = {
    sameCategory: (...args) => recommend("same_category", args),
    cartValueUpgrade: (...args) => recommend("cart_value_upgrade", args),
  };
  const coOccurrence: CrossSellCoOccurrencePort = { recommend: (...args) => recommend("co_occurrence", args) };
  const strategies: CrossSellPreviewStrategiesPort = {
    createCatalog() {
      const instance = { ...catalog };
      catalogInstances.push(instance);
      return instance;
    },
    createCoOccurrence() {
      const instance = { ...coOccurrence };
      coOccurrenceInstances.push(instance);
      return instance;
    },
  };
  const preview = new PublicProductCrossSellPreview(prisma, strategies);
  t.after(() => {
    assert.deepEqual(unexpected, [], "Public preview may access only its read projections");
    for (const { method, query } of reads) {
      if (method === "promotions") {
        assert.equal(query.where.merchantId, merchantId);
        assert.equal(query.where.status, "active");
        assert.ok(query.where.startsAt?.lte instanceof Date);
        assert.deepEqual(query.where.OR, [{ endsAt: null }, { endsAt: { gte: query.where.startsAt.lte } }]);
      } else {
        assert.deepEqual(query.where.product, { merchantId, isActive: true, deletedAt: null });
        assert.equal(query.where.isActive, true);
      }
    }
  });
  return { preview, calls, reads, merchantId, catalogInstances, coOccurrenceInstances };
}

test("public preview prioritizes matching promotions without invoking a strategy", async t => {
  const h = harness(t, { promotions: [{ id: "promo", trigger: { sku_in_cart: ["VIEWED"] }, recommendedSkus: ["COMPANION"], discountPercent: 10 }] });
  const result = await h.preview.suggest(h.merchantId, settings(["complementary"]), ["VIEWED"]);
  assert.equal(result?.products[0]?.promoId, "promo");
  assert.equal(result?.products[0]?.discountPercent, 10);
  assert.equal(result?.products[0]?.price, 25);
  assert.equal((result?.products[0] as any)?.productId, "product_COMPANION");
  assert.equal(result?.displayMode, "modal");
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.catalogInstances, []);
  assert.deepEqual(h.coOccurrenceInstances, []);
  assert.deepEqual(h.reads.map(read => read.method), ["promotions", "resolve"]);
});

for (const strategy of ["same_category", "ai_personalized"]) {
  test(`public preview creates fresh ${strategy} recommenders and resolves current prices on every invocation`, async t => {
    const currentVariant = variant("COMPANION");
    const h = harness(t, { variants: [currentVariant] });
    const first = await h.preview.suggest(h.merchantId, settings([strategy]), ["VIEWED"]);
    currentVariant.price.basePriceInCents = 9900;
    const second = await h.preview.suggest(h.merchantId, settings([strategy]), ["VIEWED"]);
    assert.equal(first?.products[0]?.price, 25);
    assert.equal(second?.products[0]?.price, 99);
    assert.equal(h.catalogInstances.length, 2);
    assert.notEqual(h.catalogInstances[0], h.catalogInstances[1]);
    if (strategy === "ai_personalized") {
      assert.equal(h.coOccurrenceInstances.length, 2);
      assert.notEqual(h.coOccurrenceInstances[0], h.coOccurrenceInstances[1]);
    } else assert.deepEqual(h.coOccurrenceInstances, []);
    assert.equal(h.calls.length, 2);
    assert.equal(h.reads.filter(read => read.method === "promotions").length, 2);
    assert.equal(h.reads.filter(read => read.method === "resolve").length, 2);
  });
}

for (const strategy of ["same_category", "cart_value_upgrade", "bought_together", "complementary", "ai_personalized"]) {
  test(`public preview delegates ${strategy} to its injected port with the original tenant and limit`, async t => {
    const h = harness(t);
    const result = await h.preview.suggest(h.merchantId, settings([strategy]), ["VIEWED"]);
    assert.equal(result?.products[0]?.id, "variant_COMPANION");
    assert.equal((result?.products[0] as any)?.productId, "product_COMPANION");
    assert.equal(result?.products[0]?.price, 25);
    assert.equal(result?.products[0]?.promoId, undefined);
    const method = strategy === "same_category" || strategy === "cart_value_upgrade" ? strategy : "co_occurrence";
    assert.deepEqual(h.calls, [{ method, args: strategy === "cart_value_upgrade"
      ? [h.merchantId, ["VIEWED"], 129.9, 3] : [h.merchantId, ["VIEWED"], 3] }]);
    assert.deepEqual(h.reads.map(read => read.method), strategy === "cart_value_upgrade"
      ? ["promotions", "viewed", "resolve"] : ["promotions", "resolve"]);
  });
}

test("public preview preserves zero upgrade threshold when the viewed price is absent", async t => {
  const h = harness(t, { viewedPrice: null });
  assert.ok(await h.preview.suggest(h.merchantId, settings(["cart_value_upgrade"]), ["VIEWED"]));
  assert.deepEqual(h.calls, [{ method: "cart_value_upgrade", args: [h.merchantId, ["VIEWED"], 0, 3] }]);
});

test("public preview uses only the first valid strategy and does not chain fallback providers", async t => {
  const h = harness(t, { skus: [] });
  assert.equal(await h.preview.suggest(h.merchantId, settings(["unknown", "same_category", "bought_together"]), ["VIEWED"]), undefined);
  assert.deepEqual(h.calls, [{ method: "same_category", args: [h.merchantId, ["VIEWED"], 3] }]);
  assert.deepEqual(h.reads.map(read => read.method), ["promotions"]);
});

test("public preview filters viewed, unavailable, zero-price and unresolved SKUs before the configured limit", async t => {
  const h = harness(t, { skus: ["viewed", "SOLD", "ZERO", "UNKNOWN", "SERVICE", "DIGITAL", "THIRD"],
    variants: [variant("viewed"), variant("SOLD", 2500, 2, 2), variant("ZERO", 0),
      variant("SERVICE", 4900, 0, 0, "service"), variant("DIGITAL", 9900, 0, 0, "digital"), variant("THIRD")] });
  const result = await h.preview.suggest(h.merchantId, settings(), ["VIEWED"]);
  assert.deepEqual(result?.products.map(product => product.id), ["variant_SERVICE", "variant_DIGITAL"]);
  assert.ok(result?.products.every(product => product.inStock));
});

for (const failure of ["promotions", "resolve", "viewed", "strategy"] as const) {
  test(`public preview preserves its undefined fallback on ${failure} failures`, async t => {
    const h = harness(t, { failure });
    assert.equal(await h.preview.suggest(h.merchantId, settings(["cart_value_upgrade"]), ["VIEWED"]), undefined);
    assert.ok(h.reads.length > 0);
  });
}

for (const [name, config, viewed] of [
  ["disabled", { crossSell: { enabled: false } }, ["VIEWED"]],
  ["disabled pre_cart", { crossSell: { ...settings().crossSell, touchpoints: { pre_cart: false } } }, ["VIEWED"]],
  ["empty strategies", settings([]), ["VIEWED"]],
  ["empty viewed SKUs", settings(), []],
] as const) {
  test(`public preview performs no IO for ${name}`, async t => {
    const h = harness(t);
    assert.equal(await h.preview.suggest(h.merchantId, config, [...viewed]), undefined);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.calls, []);
  });
}

test("public preview keeps identical SKU recommendations scoped to each merchant", async t => {
  for (const merchantId of ["merchant_a", "merchant_b"]) {
    const h = harness(t, { merchantId });
    assert.ok(await h.preview.suggest(merchantId, settings(), ["VIEWED"]));
    assert.deepEqual(h.calls, [{ method: "same_category", args: [merchantId, ["VIEWED"], 3] }]);
  }
});

