import assert from "node:assert/strict";
import test from "node:test";
import type {
  CommerceCatalogPage,
  CommerceCatalogPort,
  CommerceCatalogProduct,
} from "@aacp/commerce-adapters";
import { TenantStorefrontCatalogAdapter } from "./tenant-storefront-catalog.adapter.js";

test("tenant storefront catalog flattens only available variants for the owning merchant", async () => {
  const commerce = new StubCatalog();
  const catalog = new TenantStorefrontCatalogAdapter(commerce);

  const products = await catalog.search("mrc_1", "hub", 8);

  assert.equal(commerce.lastMerchantId, "mrc_1");
  assert.equal(products.length, 1);
  assert.equal(products[0]?.sku, "HUB-001");
  assert.equal(products[0]?.unit_price, 299.9);
});

class StubCatalog implements CommerceCatalogPort {
  lastMerchantId?: string;

  async searchCatalog(input: {
    merchantId: string;
  }): Promise<CommerceCatalogPage> {
    this.lastMerchantId = input.merchantId;
    return {
      products: [product()],
      nextCursor: null,
    };
  }

  async findCatalogProductBySku(): Promise<CommerceCatalogProduct | null> {
    return product();
  }
}

function product(): CommerceCatalogProduct {
  return {
    id: "prod_1",
    title: "Smart Hub",
    variants: [
      {
        id: "var_1",
        sku: "HUB-001",
        title: "Graphite",
        unitPriceCents: 29_990,
        currency: "BRL",
        inventoryQuantity: 4,
        availableForSale: true,
      },
      {
        id: "var_2",
        sku: "HUB-OUT",
        title: "Silver",
        unitPriceCents: 29_990,
        currency: "BRL",
        inventoryQuantity: 0,
        availableForSale: false,
      },
    ],
  };
}
