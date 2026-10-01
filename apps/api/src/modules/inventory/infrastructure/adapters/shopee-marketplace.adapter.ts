import { Injectable } from "@nestjs/common";
import type { MarketplaceContext, MarketplacePage, MarketplaceProduct, MarketplaceProviderPort } from "../../domain/ports/marketplace-provider.port.js";
import { marketplaceId, marketplaceJson, marketplacePrice, marketplaceQuantity, shopeeNumericId, shopeeSignedUrl } from "./marketplace-api.js";

@Injectable()
export class ShopeeMarketplaceAdapter implements MarketplaceProviderPort {
  constructor(private readonly context: MarketplaceContext = {}) {}

  async listProducts(accessToken: string, page = 0, cursor?: string): Promise<MarketplacePage> {
    const offset = cursor ?? String(page * 50);
    const listing = await this.request(accessToken, "/api/v2/product/get_item_list", { offset, page_size: "50", item_status: "NORMAL" });
    if (!Array.isArray(listing.item)) throw new Error("erp_shopee_response_invalid");
    const ids = listing.item.map((item: any) => marketplaceId(item.item_id));
    const products: MarketplaceProduct[] = [];
    if (ids.length) {
      const details = await this.request(accessToken, "/api/v2/product/get_item_base_info", { item_id_list: ids.join(",") });
      if (!Array.isArray(details.item_list) || details.item_list.length !== ids.length) throw new Error("erp_shopee_product_details_missing");
      for (const item of details.item_list) {
        const itemId = marketplaceId(item.item_id);
        if (!ids.includes(itemId)) throw new Error("erp_shopee_product_details_invalid");
        if (item.has_model) {
          const models = await this.request(accessToken, "/api/v2/product/get_model_list", { item_id: itemId });
          if (!Array.isArray(models.model) || !models.model.length) throw new Error("erp_shopee_models_missing");
          for (const model of models.model) products.push(this.product(item, model, marketplaceId(model.model_id)));
        } else {
          products.push(this.product(item, item, "0"));
        }
      }
    }
    const hasMore = listing.has_next_page === true;
    const nextCursor = hasMore ? String(listing.next_offset ?? "") : undefined;
    if (hasMore && (!ids.length || !nextCursor || nextCursor === offset)) throw new Error("erp_shopee_pagination_invalid");
    return { products, hasMore, nextCursor };
  }

  async updateStock(accessToken: string, itemId: string, quantity: number): Promise<boolean> {
    const [productId, modelId, ...extra] = itemId.split(":");
    if (extra.length || modelId === undefined) throw new Error("erp_shopee_mapping_invalid");
    const result = await this.request(accessToken, "/api/v2/product/update_stock", {}, {
      item_id: shopeeNumericId(productId),
      stock_list: [{ ...(modelId !== "0" ? { model_id: shopeeNumericId(modelId) } : {}), seller_stock: [{ stock: marketplaceQuantity(quantity) }] }],
    });
    if (result.failure_list?.length) throw new Error("erp_shopee_stock_write_rejected");
    return true;
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const shop = await this.request(accessToken, "/api/v2/shop/get_shop_info");
    const sellerId = marketplaceId(shop.shop_id ?? this.context.shopId);
    if (sellerId !== this.context.shopId) throw new Error("erp_marketplace_account_mismatch");
    return { sellerId, name: String(shop.shop_name ?? sellerId) };
  }

  private product(item: any, variant: any, modelId: string): MarketplaceProduct {
    const stock = variant.stock_info_v2;
    if (stock?.seller_stock?.length > 1) throw new Error("erp_multi_location_requires_mapping");
    if (stock?.shopee_stock?.some((entry: any) => Number(entry.stock) > 0)) throw new Error("erp_shopee_managed_stock_not_supported");
    return {
      id: `${marketplaceId(item.item_id)}:${modelId}`,
      title: String(item.item_name ?? ""),
      sku: variant.model_sku || item.item_sku || undefined,
      stock: marketplaceQuantity(stock?.summary_info?.total_available_stock),
      salePriceCents: marketplacePrice(variant.price_info?.[0]?.current_price, "BRL"),
    };
  }

  private async request(token: string, path: string, params: Record<string, string> = {}, body?: unknown): Promise<any> {
    if (!this.context.shopId) throw new Error("erp_shopee_shop_id_missing");
    const data = await marketplaceJson("shopee", shopeeSignedUrl(path, token, this.context.shopId, params), body === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return data.response ?? data;
  }
}
