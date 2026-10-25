import { Injectable } from "@nestjs/common";
import type { MarketplaceProviderPort, MarketplaceProduct } from "../../domain/ports/marketplace-provider.port.js";
import { requestShopee, shopeeShopId } from "./shopee-api.js";

interface ShopeeProduct extends MarketplaceProduct { itemId: number; modelId: number; stockInfo: any; }
@Injectable()
export class ShopeeMarketplaceAdapter implements MarketplaceProviderPort {
  private readonly shopId: string;
  private readonly offsets = new Map<number, number>([[0, 0]]);
  constructor(config: Record<string, unknown> = {}) { this.shopId = shopeeShopId(config.shopeeShopId); }

  private product(item: any, model?: any): ShopeeProduct {
    const itemId = Number(item.item_id), modelId = model ? Number(model.model_id) : 0;
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(modelId) || modelId < 0 || !item.item_name) throw new Error("shopee_product_invalid");
    const info = (model ?? item).stock_info_v2;
    const stock = info?.summary_info?.total_available_stock;
    if (!Number.isSafeInteger(stock) || stock < 0) throw new Error("shopee_product_stock_missing");
    return { id: `${itemId}:${modelId}`, itemId, modelId, title: model?.model_name ? `${item.item_name} - ${model.model_name}` : item.item_name,
      sku: (model ? model.model_sku : item.item_sku) || `shopee:${this.shopId}:${itemId}:${modelId}`, stock, stockInfo: info };
  }

  async listProducts(accessToken: string, page = 0): Promise<{ products: ShopeeProduct[]; hasMore: boolean }> {
    const offset = this.offsets.get(page);
    if (offset === undefined) throw new Error("shopee_page_cursor_missing");
    const list = await requestShopee(accessToken, this.shopId, "/api/v2/product/get_item_list", { offset: String(offset), page_size: "50", item_status: "NORMAL" });
    if (!Array.isArray(list.response?.item) || typeof list.response.has_next_page !== "boolean") throw new Error("shopee_product_list_invalid");
    const ids = list.response.item.map((item: any) => shopeeShopId(item.item_id));
    const products: ShopeeProduct[] = [];
    if (ids.length) {
      const details = await requestShopee(accessToken, this.shopId, "/api/v2/product/get_item_base_info", { item_id_list: ids.join(",") });
      if (!Array.isArray(details.response?.item_list) || details.response.item_list.length !== ids.length) throw new Error("shopee_product_details_incomplete");
      for (const item of details.response.item_list) {
        if (!ids.includes(String(item.item_id))) throw new Error("shopee_product_details_mismatch");
        if (item.has_model) {
          const models = await requestShopee(accessToken, this.shopId, "/api/v2/product/get_model_list", { item_id: String(item.item_id) });
          if (!Array.isArray(models.response?.model) || !models.response.model.length) throw new Error("shopee_product_models_missing");
          for (const model of models.response.model) if (!model.model_status || model.model_status === "MODEL_NORMAL") products.push(this.product(item, model));
        } else products.push(this.product(item));
      }
    }
    const hasMore = list.response.has_next_page;
    if (hasMore) {
      const next = list.response.next_offset;
      if (!Number.isSafeInteger(next) || next <= offset || !ids.length) throw new Error("shopee_page_cursor_invalid");
      this.offsets.set(page + 1, next);
    }
    return { products, hasMore };
  }

  async updateStock(accessToken: string, sku: string, quantity: number): Promise<boolean> {
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("shopee_stock_invalid");
    // Seller SKUs are not Shopee item IDs. Resolve the parent and variation in this authorized shop.
    const matches: ShopeeProduct[] = [];
    let page = 0, hasMore = true;
    while (hasMore) {
      const list = await this.listProducts(accessToken, page++);
      matches.push(...list.products.filter(product => product.sku === sku));
      hasMore = list.hasMore;
    }
    if (matches.length !== 1) throw new Error(matches.length ? "shopee_sku_ambiguous" : "shopee_sku_missing");
    const product = matches[0]!;
    const seller = product.stockInfo?.seller_stock;
    const reserved = product.stockInfo?.summary_info?.total_reserved_stock;
    if (!Array.isArray(seller) || seller.length !== 1 || !Number.isSafeInteger(reserved) || reserved < 0 ||
        product.stockInfo?.shopee_stock?.some((entry: any) => Number(entry.stock) > 0)) throw new Error("shopee_stock_warehouse_selection_required");
    const location = seller[0].location_id;
    const result = await requestShopee(accessToken, this.shopId, "/api/v2/product/update_stock", {}, {
      item_id: product.itemId, stock_list: [{ model_id: product.modelId, seller_stock: [{ stock: quantity + reserved, ...(location && location !== "-" ? { location_id: location } : {}) }] }],
    });
    if (!Array.isArray(result.response?.failure_list) || result.response.failure_list.length) throw new Error("shopee_stock_update_rejected");
    if (!result.response.success_list?.some((entry: any) => Number(entry.model_id) === product.modelId)) throw new Error("shopee_stock_update_unconfirmed");
    return true;
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const data = await requestShopee(accessToken, this.shopId, "/api/v2/shop/get_shop_info");
    if (typeof data.shop_name !== "string" || !data.shop_name) throw new Error("shopee_shop_identity_invalid");
    return { sellerId: this.shopId, name: data.shop_name };
  }
}
