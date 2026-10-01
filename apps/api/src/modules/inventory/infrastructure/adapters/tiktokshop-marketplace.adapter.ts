import { Injectable } from "@nestjs/common";
import type { MarketplaceContext, MarketplacePage, MarketplaceProduct, MarketplaceProviderPort } from "../../domain/ports/marketplace-provider.port.js";
import { marketplaceId, marketplaceJson, marketplacePrice, marketplaceQuantity, requiredMarketplaceEnv, tiktokSignature } from "./marketplace-api.js";

@Injectable()
export class TikTokShopMarketplaceAdapter implements MarketplaceProviderPort {
  constructor(private readonly context: MarketplaceContext = {}) {}

  async listProducts(accessToken: string, _page = 0, cursor?: string): Promise<MarketplacePage> {
    const data = await this.request(accessToken, "/product/202309/products/search", {
      shop_cipher: this.shopCipher(), page_size: "50", ...(cursor ? { page_token: cursor } : {}),
    }, { status: "ACTIVATE" });
    if (!Array.isArray(data.products)) throw new Error("erp_tiktokshop_response_invalid");
    const products: MarketplaceProduct[] = [];
    for (const item of data.products) {
      if (!Array.isArray(item.skus) || !item.skus.length) throw new Error("erp_tiktokshop_skus_missing");
      for (const sku of item.skus) {
        if (!Array.isArray(sku.inventory) || !sku.inventory.length) throw new Error("erp_marketplace_stock_missing");
        if (sku.inventory.length !== 1) throw new Error("erp_multi_location_requires_mapping");
        const inventory = sku.inventory[0];
        products.push({
          id: `${marketplaceId(item.id)}:${marketplaceId(sku.id)}:${marketplaceId(inventory.warehouse_id)}`,
          title: String(item.title ?? ""), sku: sku.seller_sku || undefined,
          stock: marketplaceQuantity(inventory.quantity),
          salePriceCents: marketplacePrice(sku.price?.sale_price ?? sku.price?.tax_exclusive_price, sku.price?.currency),
        });
      }
    }
    const nextCursor = data.next_page_token || undefined;
    if (nextCursor && (!data.products.length || nextCursor === cursor)) throw new Error("erp_tiktokshop_pagination_invalid");
    return { products, hasMore: Boolean(nextCursor), nextCursor };
  }

  async updateStock(accessToken: string, itemId: string, quantity: number): Promise<boolean> {
    const parts = itemId.split(":");
    if (parts.length !== 3) throw new Error("erp_tiktokshop_mapping_invalid");
    const [productId, skuId, warehouseId] = parts.map(marketplaceId);
    const data = await this.request(accessToken, `/product/202309/products/${productId}/inventory/update`, { shop_cipher: this.shopCipher() }, {
      skus: [{ id: skuId, inventory: [{ warehouse_id: warehouseId, quantity: marketplaceQuantity(quantity) }] }],
    });
    if (data.errors?.length) throw new Error("erp_tiktokshop_stock_write_rejected");
    return true;
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string; shopCipher: string }> {
    const data = await this.request(accessToken, "/authorization/202309/shops");
    if (!Array.isArray(data.shops) || !data.shops.length) throw new Error("erp_tiktokshop_shop_missing");
    const shop = this.context.shopId ? data.shops.find((candidate: any) => String(candidate.id) === this.context.shopId) : data.shops.length === 1 ? data.shops[0] : undefined;
    if (!shop) throw new Error(this.context.shopId ? "erp_marketplace_account_mismatch" : "erp_shop_selection_required");
    if (!shop.cipher) throw new Error("erp_tiktokshop_shop_cipher_missing");
    return { sellerId: marketplaceId(shop.id), name: String(shop.name ?? shop.id), shopCipher: String(shop.cipher) };
  }

  private shopCipher(): string {
    if (!this.context.shopCipher) throw new Error("erp_tiktokshop_shop_cipher_missing");
    return this.context.shopCipher;
  }

  private async request(token: string, path: string, extra: Record<string, string> = {}, payload?: unknown): Promise<any> {
    const secret = requiredMarketplaceEnv("TIKTOKSHOP_APP_SECRET");
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const params = { ...extra, app_key: requiredMarketplaceEnv("TIKTOKSHOP_APP_KEY"), timestamp: String(Math.floor(Date.now() / 1000)) };
    const query = new URLSearchParams({ ...params, sign: tiktokSignature(path, params, secret, body) });
    const data = await marketplaceJson("tiktokshop", `https://open-api.tiktokglobalshop.com${path}?${query}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "x-tts-access-token": token, "Content-Type": "application/json" }, ...(body ? { body } : {}),
    });
    if (!data.data || typeof data.data !== "object") throw new Error("erp_tiktokshop_response_invalid");
    return data.data;
  }
}
