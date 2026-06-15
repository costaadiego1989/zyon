import { Injectable } from "@nestjs/common";
import type { SuggestedProduct } from "@aacp/shared-types";
import { FAKE_PRODUCTS, searchFakeProducts } from "@aacp/fake-commerce-api";
import type { StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";

function toHit(product: (typeof FAKE_PRODUCTS)[number]): SuggestedProduct {
  return {
    sku: product.sku,
    name: product.name,
    unit_price: product.price,
    image_url: product.imageUrl,
    product_url: product.productUrl,
    category: product.category,
    variant: product.variant,
    description: product.description?.slice(0, 100)
  };
}

@Injectable()
export class FakeStorefrontCatalogAdapter implements StorefrontCatalogPort {
  async search(
    _merchantId: string,
    query: string,
    limit = 8,
  ): Promise<SuggestedProduct[]> {
    const remote = await this.searchRemote(query, limit);
    if (remote) return remote;
    return searchFakeProducts(query, limit).map(toHit);
  }

  async findBySku(
    _merchantId: string,
    sku: string,
  ): Promise<SuggestedProduct | null> {
    const remote = await this.findRemoteBySku(sku);
    if (remote) return remote;
    const product = FAKE_PRODUCTS.find((item) => item.sku === sku && item.available);
    return product ? toHit(product) : null;
  }

  private async searchRemote(query: string, limit: number): Promise<SuggestedProduct[] | null> {
    const base = process.env.FAKE_COMMERCE_API_URL?.trim();
    if (!base) return null;
    try {
      const url = new URL("/products/search", base.replace(/\/$/, "/"));
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(limit));
      const response = await fetch(url);
      if (!response.ok) return null;
      const payload = (await response.json()) as { products?: Array<Record<string, unknown>> };
      return (payload.products ?? []).map((product) => mapRemoteProduct(product));
    } catch {
      return null;
    }
  }

  private async findRemoteBySku(sku: string): Promise<SuggestedProduct | null> {
    const hits = await this.searchRemote(sku, 20);
    return hits?.find((item) => item.sku === sku) ?? null;
  }
}

function mapRemoteProduct(product: Record<string, unknown>): SuggestedProduct {
  return {
    sku: String(product.sku ?? ""),
    name: String(product.name ?? ""),
    unit_price: Number(product.price ?? 0),
    image_url: typeof product.imageUrl === "string" ? product.imageUrl : undefined,
    product_url: typeof product.productUrl === "string" ? product.productUrl : undefined,
    category: typeof product.category === "string" ? product.category : undefined,
    variant: typeof product.variant === "string" ? product.variant : undefined,
    description: typeof product.description === "string" ? product.description.slice(0, 100) : undefined
  };
}
