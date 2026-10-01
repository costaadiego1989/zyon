import { Injectable } from "@nestjs/common";
import type { MarketplaceContext, MarketplacePage, MarketplaceProduct, MarketplaceProviderPort } from "../../domain/ports/marketplace-provider.port.js";
import { marketplaceId, marketplaceJson, marketplacePrice, marketplaceQuantity } from "./marketplace-api.js";

@Injectable()
export class MercadoLivreMarketplaceAdapter implements MarketplaceProviderPort {
  constructor(private readonly context: MarketplaceContext = {}) {}

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const seller = await this.request(accessToken, "/users/me");
    const sellerId = marketplaceId(seller.id);
    if (this.context.sellerId && this.context.sellerId !== sellerId) throw new Error("erp_marketplace_account_mismatch");
    return { sellerId, name: String(seller.nickname ?? sellerId) };
  }

  async listProducts(accessToken: string, _page = 0, cursor?: string): Promise<MarketplacePage> {
    const sellerId = this.context.sellerId ?? (await this.getSellerInfo(accessToken)).sellerId;
    const query = new URLSearchParams({ search_type: "scan", limit: "50", ...(cursor ? { scroll_id: cursor } : {}) });
    const listing = await this.request(accessToken, `/users/${marketplaceId(sellerId)}/items/search?${query}`);
    // Scan returns null/empty results at the end; failures never become zero stock.
    if (listing.results !== null && !Array.isArray(listing.results)) throw new Error("erp_mercadolivre_response_invalid");
    const ids: string[] = (listing.results ?? []).map(marketplaceId);
    const products: MarketplaceProduct[] = [];
    for (let offset = 0; offset < ids.length; offset += 20) {
      const batch = ids.slice(offset, offset + 20);
      const details = await this.request(accessToken, `/items?ids=${batch.join(",")}&include_attributes=all`);
      if (!Array.isArray(details) || details.length !== batch.length) throw new Error("erp_mercadolivre_product_details_missing");
      for (const entry of details) {
        if (entry.code !== 200 || !entry.body) throw new Error("erp_mercadolivre_product_details_failed");
        const item = entry.body;
        if (!batch.includes(String(item.id)) || String(item.seller_id) !== sellerId) throw new Error("erp_marketplace_account_mismatch");
        if (item.shipping?.logistic_type === "fulfillment") throw new Error("erp_mercadolivre_managed_stock_not_supported");
        const variants = item.variations?.length ? item.variations : [item];
        for (const variant of variants) {
          products.push({
            id: item.variations?.length ? `${marketplaceId(item.id)}:${marketplaceId(variant.id)}` : marketplaceId(item.id),
            title: String(item.title ?? ""),
            sku: variant.attributes?.find((attribute: any) => attribute.id === "SELLER_SKU")?.value_name || variant.seller_custom_field || (!item.variations?.length ? item.attributes?.find((attribute: any) => attribute.id === "SELLER_SKU")?.value_name : undefined),
            stock: marketplaceQuantity(variant.available_quantity),
            salePriceCents: marketplacePrice(variant.price ?? item.price, item.currency_id),
          });
        }
      }
    }
    const hasMore = ids.length > 0;
    const nextCursor = hasMore ? listing.scroll_id : undefined;
    if (hasMore && !nextCursor) throw new Error("erp_mercadolivre_pagination_invalid");
    // Mercado Livre intentionally reuses a scroll ID across multiple pages.
    return { products, hasMore, nextCursor };
  }

  async updateStock(accessToken: string, itemId: string, quantity: number): Promise<boolean> {
    const [productId, variationId, ...extra] = itemId.split(":");
    if (extra.length) throw new Error("erp_mercadolivre_mapping_invalid");
    const path = `/items/${marketplaceId(productId)}${variationId ? `/variations/${marketplaceId(variationId)}` : ""}`;
    await this.request(accessToken, path, { method: "PUT", body: JSON.stringify({ available_quantity: marketplaceQuantity(quantity) }) });
    return true;
  }

  private request(token: string, path: string, init?: RequestInit): Promise<any> {
    return marketplaceJson("mercadolivre", `https://api.mercadolibre.com${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  }
}
