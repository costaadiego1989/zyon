import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { resolveCrossSellCartItem, resolveCrossSellProduct } from "./cross-sell-product-resolver.js";

function productRepo(overrides: { active?: boolean; variantActive?: boolean; stock?: number; reserved?: number; type?: string } = {}): ProductRepositoryPort {
  const product = {
    id: "product_1", merchantId: "merchant_1", name: "Necessaire Executiva", type: overrides.type ?? "physical",
    isActive: overrides.active ?? true, categoryId: "acessorios",
    variants: [{
      id: "variant_1", sku: "NECS-001", attributes: {}, isActive: overrides.variantActive ?? true,
      basePriceInCents: 4990, costInCents: 1200, taxPercent: 0, currency: "BRL",
      stockQuantity: overrides.stock ?? 4, stockReserved: overrides.reserved ?? 0, media: [],
    }],
  };
  return {
    findById: async () => null,
    search: async () => ({ products: [product] as any, total: 1 }),
  } as ProductRepositoryPort;
}

describe("cross-sell-product-resolver", () => {
  it("resolves a sellable merchant catalog SKU in BRL major units", async () => {
    const result = await resolveCrossSellProduct("NECS-001", productRepo(), "merchant_1", "sugg_1");
    assert.deepEqual(result && {
      sku: result.sku, name: result.name, unit_price: result.unit_price, suggestion_id: result.suggestion_id,
    }, { sku: "NECS-001", name: "Necessaire Executiva", unit_price: 49.9, suggestion_id: "sugg_1" });
  });

  it("uses the catalog price and cost when adding an accepted SKU", async () => {
    const item = await resolveCrossSellCartItem("NECS-001", productRepo(), "merchant_1");
    assert.deepEqual(item && { sku: item.sku, price: item.price, cost: item.cost, quantity: item.quantity }, {
      sku: "NECS-001", price: 49.9, cost: 12, quantity: 1,
    });
  });

  it("never invents an item for an unknown SKU", async () => {
    assert.equal(await resolveCrossSellProduct("UNKNOWN", productRepo(), "merchant_1"), null);
    assert.equal(await resolveCrossSellCartItem("UNKNOWN", productRepo(), "merchant_1"), null);
  });

  it("rejects inactive and unavailable physical catalog variants", async () => {
    assert.equal(await resolveCrossSellProduct("NECS-001", productRepo({ active: false }), "merchant_1"), null);
    assert.equal(await resolveCrossSellProduct("NECS-001", productRepo({ variantActive: false }), "merchant_1"), null);
    assert.equal(await resolveCrossSellProduct("NECS-001", productRepo({ stock: 2, reserved: 2 }), "merchant_1"), null);
  });

  it("allows catalog digital products without physical stock", async () => {
    const result = await resolveCrossSellProduct("NECS-001", productRepo({ type: "digital", stock: 0 }), "merchant_1");
    assert.equal(result?.unit_price, 49.9);
  });
});
