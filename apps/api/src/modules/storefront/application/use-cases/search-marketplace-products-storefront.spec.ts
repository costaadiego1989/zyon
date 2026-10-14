import test from "node:test";
import assert from "node:assert/strict";
import { SearchMarketplaceProductsStorefrontUseCase } from "./search-marketplace-products-storefront.use-case.js";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import { marketplaceVariantLabel } from "../../../marketplace/domain/services/marketplace-variant.js";

test("storefront limits always respect the federated search contract", async () => {
  const calls: number[] = [];
  const useCase = new SearchMarketplaceProductsStorefrontUseCase({ execute: async ({ limit }: any) => {
    assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 20);
    calls.push(limit); return { products: [] };
  } } as any, { merchant: { findMany: async () => [] } } as any, { getEffectivePlan: async () => "scale" } as any);
  for (const limit of [undefined, 1, 10, 11, 20, 100, -1, NaN, 1.5]) {
    await useCase.execute({ merchantId: "host", query: "produto", limit });
  }
  assert.equal(calls.length, 9);
});

test("a missing marketplace configuration cannot activate federated search", async () => {
  const useCase = new SearchFederatedProductsUseCase({} as any, { get: async () => undefined } as any,
    { search: async () => { assert.fail("must not search"); } } as any, {} as any);
  assert.deepEqual(await useCase.execute({ hostMerchantId: "unconfigured", query: "produto" }), { products: [] });
});

test("a storefront on a non-Scale plan cannot expose federated marketplace products", async () => {
  const search = { execute: async () => { assert.fail("marketplace search must not run"); } };
  const useCase = new SearchMarketplaceProductsStorefrontUseCase(search as any, {} as any, {
    getEffectivePlan: async () => "growth",
  } as any);
  assert.deepEqual(await useCase.execute({ merchantId: "growth-store", query: "produto" }), { products: [] });
  assert.equal(await useCase.resolveById({ merchantId: "growth-store", federatedProductId: "federated" }), undefined);
});

const canonicalProduct = { id: "product", merchantId: "seller", name: "Camiseta", categoryId: "fashion", type: "physical", isActive: true, deletedAt: null, metadata: null };
const variant = (id: string, price = 5000, stock = [{ quantity: 4, reserved: 0 }]) => ({ id, sku: id, attributes: { size: id },
  productId: "product", product: canonicalProduct, isActive: true, price: { basePriceInCents: price, currency: "BRL" }, stock, media: [] });
function canonicalSearch(rows: any[], overrides: { host?: any; seller?: any; connection?: any; projection?: any; failure?: boolean } = {}) {
  const projection = { id: "federated", sourceMerchantId: "seller", sourceProductId: "product", name: "Old name", priceCents: 1, stockAvailable: true };
  const merchant = { name: "Parceira", billingSubscription: { planKey: "scale", status: "active" },
    marketplaceConfig: { enabled: true, blockedMerchants: [], allowedCategories: [] } };
  return new SearchMarketplaceProductsStorefrontUseCase({ execute: async () => ({ products: [projection] }) } as any, {
    federatedProduct: { findUnique: async ({ where }: any) => where.id === "federated" ? overrides.projection ?? projection : null },
    merchant: { findUnique: async ({ where }: any) => { if (overrides.failure) throw new Error("database_unavailable");
      return where.id === "host" ? overrides.host ?? merchant : overrides.seller ?? merchant; } },
    marketplaceConnection: { findUnique: async () => overrides.connection ?? { status: "active" } }, productVariant: { findMany: async (query: any) => {
      assert.deepEqual(query.where.product, { merchantId: "seller", isActive: true, deletedAt: null });
      assert.equal(query.where.productId, "product"); assert.equal(query.take, 51); return rows;
    } },
  } as any, { getEffectivePlan: async () => "scale" } as any);
}

test("public marketplace options use current seller-bound prices and each warehouse availability", async () => {
  const rows = [variant("P", 5000, [{ quantity: 1, reserved: 1 }, { quantity: 2, reserved: 0 }]), variant("G", 6500, [{ quantity: 0, reserved: 0 }])];
  const { products } = await canonicalSearch(rows).execute({ merchantId: "host", query: "Camiseta" });
  assert.equal(products[0].name, "Camiseta"); assert.equal(products[0].price, 50); assert.equal(products[0].inStock, true);
  assert.deepEqual(products[0].variants.map(row => ({ id: row.id, label: row.label, price: row.price, inStock: row.inStock })), [
    { id: "P", label: "Tamanho: P", price: 50, inStock: true }, { id: "G", label: "Tamanho: G", price: 65, inStock: false }]);
  assert.equal(JSON.stringify(products).includes("attributes"), false); assert.equal(JSON.stringify(products).includes("stock"), false);
});

test("federated details and search share the current canonical seller product without source UUID lookup", async () => {
  const useCase = canonicalSearch([variant("P", 5000, [{ quantity: 0, reserved: 0 }]), variant("G", 6500)]);
  const search = await useCase.execute({ merchantId: "host", query: "Camiseta" });
  const detail = await useCase.resolveById({ merchantId: "host", federatedProductId: "federated" });
  assert.deepEqual(detail, search.products[0]);
  assert.equal(detail?.price, 65); assert.equal(detail?.sellerName, "Parceira");
  assert.deepEqual(detail?.variants.map(v => [v.id, v.inStock]), [["P", false], ["G", true]]);
  for (const id of ["G", "foreign", " federated", "federated\n", "x".repeat(201)]) {
    assert.equal(await useCase.resolveById({ merchantId: "host", federatedProductId: id }), undefined);
  }
});

test("direct federated IDs obey current commercial, connection, block and canonical category gates", async () => {
  const eligible = { name: "Parceira", billingSubscription: { planKey: "scale", status: "active" },
    marketplaceConfig: { enabled: true, blockedMerchants: [], allowedCategories: [] } };
  const blocked = (id: string) => ({ ...eligible, marketplaceConfig: { ...eligible.marketplaceConfig, blockedMerchants: [id] } });
  for (const overrides of [
    { host: { ...eligible, billingSubscription: { planKey: "growth", status: "active" } } },
    { seller: { ...eligible, billingSubscription: { planKey: "scale", status: "canceled" } } },
    { host: { ...eligible, marketplaceConfig: { ...eligible.marketplaceConfig, enabled: false } } },
    { seller: { ...eligible, marketplaceConfig: { ...eligible.marketplaceConfig, enabled: false } } },
    { host: blocked("seller") }, { seller: blocked("host") }, { connection: { status: "pending" } },
    { host: { ...eligible, marketplaceConfig: { ...eligible.marketplaceConfig, allowedCategories: ["stale-index-category"] } } },
  ]) {
    const useCase = canonicalSearch([variant("P")], overrides);
    assert.deepEqual(await useCase.execute({ merchantId: "host", query: "Camiseta" }), { products: [] });
    assert.equal(await useCase.resolveById({ merchantId: "host", federatedProductId: "federated" }), undefined);
  }
  const billingAccount = { ...eligible, billingSubscription: { planKey: "starter", status: "active" },
    billingAccountMerchantId: "account", billingAccount: { billingSubscription: eligible.billingSubscription } };
  assert.ok(await canonicalSearch([variant("P")], { host: billingAccount }).resolveById({ merchantId: "host", federatedProductId: "federated" }));
});

test("infrastructure failure never publishes stale index prices as a canonical product", async () => {
  const useCase = canonicalSearch([variant("P")], { failure: true });
  await assert.rejects(useCase.execute({ merchantId: "host", query: "Camiseta" }), /database_unavailable/);
  await assert.rejects(useCase.resolveById({ merchantId: "host", federatedProductId: "federated" }), /database_unavailable/);
});

test("invalid canonical products, prices, required customizations and truncated option lists fail closed", async () => {
  const required = { optionGroups: [{ id: "addon", name: "Escolha", required: true, selectionType: "single", items: [{ id: "item", name: "Extra" }] }] };
  for (const rows of [[], [variant("P", 0)], [{ ...variant("P"), price: { basePriceInCents: 1, currency: "USD" } }],
    [{ ...variant("P"), product: { ...canonicalProduct, merchantId: "foreign" } }],
    [{ ...variant("P"), product: { ...canonicalProduct, deletedAt: new Date() } }],
    [{ ...variant("P"), product: { ...canonicalProduct, metadata: required } }],
    Array.from({ length: 51 }, (_, index) => variant(String(index)))]) {
    assert.deepEqual(await canonicalSearch(rows).execute({ merchantId: "host", query: "Camiseta" }), { products: [] });
  }
});

test("canonical option labels bound plain attributes and never serialize nested metadata", () => {
  assert.equal(marketplaceVariantLabel({ size: "G", color: "Azul", private: { nested: "hidden" } }, "sku"), "Cor: Azul · Tamanho: G");
  assert.equal(marketplaceVariantLabel({}, " SKU-G\n "), "SKU-G");
  const label = marketplaceVariantLabel(Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`field-${n}`, "x".repeat(500)])), "sku");
  assert.ok(label.length <= 180); assert.equal(label.includes("field-9"), false);
});
