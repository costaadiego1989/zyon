import { Injectable, Logger } from "@nestjs/common";
import type { MarketplaceProviderPort, MarketplaceProduct } from "../../domain/ports/marketplace-provider.port.js";
import { getTikTokShopIdentity, requestTikTokShop, type TikTokShopIdentity } from "./tiktokshop-api.js";

interface TikTokSku { id: string; seller_sku?: string; inventory?: Array<{ warehouse_id: string; quantity: number }>; }
interface TikTokProduct { id: string; title: string; skus?: TikTokSku[]; }
interface SearchResult { products: TikTokProduct[]; next_page_token?: string; }

@Injectable()
export class TikTokShopMarketplaceAdapter implements MarketplaceProviderPort {
  private readonly logger = new Logger(TikTokShopMarketplaceAdapter.name);
  private readonly cursors = new Map<number, string>();
  private identity?: TikTokShopIdentity;
  private identityToken?: string;
  private paginationToken?: string;

  constructor(private readonly config: Record<string, unknown> = {}) {}

  private async shop(accessToken: string): Promise<TikTokShopIdentity> {
    if (this.identity && this.identityToken === accessToken) return this.identity;
    const selected = typeof this.config.tiktokShopId === "string" ? this.config.tiktokShopId : undefined;
    this.identity = await getTikTokShopIdentity(accessToken, selected);
    this.identityToken = accessToken;
    return this.identity;
  }

  private async search(accessToken: string, payload: unknown, cursor?: string): Promise<SearchResult> {
    const shop = await this.shop(accessToken);
    const data = await requestTikTokShop<SearchResult>(accessToken, "/product/202309/products/search", {
      shop_cipher: shop.cipher, page_size: "50", ...(cursor ? { page_token: cursor } : {}),
    }, payload);
    if (!Array.isArray(data.products)) throw new Error("tiktokshop_products_response_invalid");
    return data;
  }

  async listProducts(accessToken: string, page = 0): Promise<{ products: MarketplaceProduct[]; hasMore: boolean }> {
    if (!Number.isSafeInteger(page) || page < 0) throw new Error("tiktokshop_page_invalid");
    if (page === 0) { this.cursors.clear(); this.paginationToken = accessToken; }
    const cursor = this.cursors.get(page);
    if (page > 0 && (!cursor || this.paginationToken !== accessToken)) throw new Error("tiktokshop_pagination_cursor_missing");
    const data = await this.search(accessToken, { status: "ACTIVATE" }, cursor);
    const next = data.next_page_token;
    if (next && (typeof next !== "string" || [...this.cursors.values()].includes(next))) throw new Error("tiktokshop_pagination_cursor_repeated");
    if (next) this.cursors.set(page + 1, next);
    const products = data.products.flatMap(product => {
      if (!product.id || !Array.isArray(product.skus)) throw new Error("tiktokshop_product_response_invalid");
      return product.skus.map(sku => {
        if (!sku.id || !Array.isArray(sku.inventory) || sku.inventory.some(i => !Number.isSafeInteger(i.quantity) || i.quantity < 0)) {
          throw new Error("tiktokshop_inventory_response_invalid");
        }
        return {
          id: `${product.id}:${sku.id}`, title: product.title ?? "",
          sku: sku.seller_sku || `${product.id}:${sku.id}`,
          stock: sku.inventory.reduce((total, i) => total + i.quantity, 0),
        };
      });
    });
    return { products, hasMore: Boolean(next) };
  }

  async updateStock(accessToken: string, sellerSku: string, quantity: number): Promise<boolean> {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !sellerSku) return false;
    try {
      // Resolve the merchant's SKU to real provider product/SKU/warehouse IDs.
      const data = await this.search(accessToken, { status: "ACTIVATE", seller_skus: [sellerSku] });
      const matches = data.products.flatMap(product => (product.skus ?? [])
        .filter(sku => sku.seller_sku === sellerSku).map(sku => ({ product, sku })));
      if (data.next_page_token || matches.length !== 1) throw new Error("tiktokshop_sku_mapping_ambiguous");
      const { product, sku } = matches[0];
      const warehouses = sku.inventory;
      if (!product.id || !sku.id || !Array.isArray(warehouses) || warehouses.length !== 1 || !warehouses[0].warehouse_id) {
        throw new Error("tiktokshop_warehouse_mapping_required");
      }
      const shop = await this.shop(accessToken);
      const result = await requestTikTokShop<{ errors?: unknown[] }>(accessToken,
        `/product/202309/products/${encodeURIComponent(product.id)}/inventory/update`, { shop_cipher: shop.cipher }, {
          skus: [{ id: sku.id, inventory: [{ warehouse_id: warehouses[0].warehouse_id, quantity }] }],
        });
      return !result.errors?.length;
    } catch (error) {
      this.logger.warn("tiktokshop.updateStock.failed", { code: error instanceof Error ? error.message : "tiktokshop_update_failed" });
      return false;
    }
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const shop = await this.shop(accessToken);
    return { sellerId: shop.id, name: shop.name };
  }
}
