import { Injectable, Logger } from "@nestjs/common";
import type { MarketplaceProviderPort, MarketplaceProduct } from "../../domain/ports/marketplace-provider.port.js";

const BASE_URL = "https://api.mercadolibre.com";

/**
 * Mercado Livre marketplace adapter.
 * Standard OAuth 2.0. No HMAC signing.
 */
@Injectable()
export class MercadoLivreMarketplaceAdapter implements MarketplaceProviderPort {
  private readonly logger = new Logger(MercadoLivreMarketplaceAdapter.name);

  async listProducts(accessToken: string, page = 0): Promise<{ products: MarketplaceProduct[]; hasMore: boolean }> {
    const limit = 50;
    const offset = page * limit;

    // Step 1: get seller id
    const seller = await this.getSellerInfo(accessToken);

    // Step 2: search items
    const searchRes = await fetch(
      `${BASE_URL}/users/${seller.sellerId}/items/search?access_token=${accessToken}&offset=${offset}&limit=${limit}`,
    );
    if (!searchRes.ok) {
      this.logger.error(`mercadolivre.listProducts failed: ${searchRes.status}`);
      return { products: [], hasMore: false };
    }
    const searchData: any = await searchRes.json();
    const itemIds: string[] = searchData.results ?? [];

    if (itemIds.length === 0) {
      return { products: [], hasMore: false };
    }

    // Step 3: fetch item details in batch (ML supports multi-get up to 20)
    const products: MarketplaceProduct[] = [];
    const chunks = this.chunk(itemIds, 20);

    for (const chunk of chunks) {
      const multiRes = await fetch(
        `${BASE_URL}/items?ids=${chunk.join(",")}&access_token=${accessToken}`,
      );
      if (multiRes.ok) {
        const items: any[] = await multiRes.json();
        for (const wrapper of items) {
          const item = wrapper.body ?? wrapper;
          if (item) {
            products.push({
              id: item.id,
              title: item.title ?? "",
              sku: item.seller_custom_field ?? undefined,
              stock: item.available_quantity ?? 0,
            });
          }
        }
      }
    }

    const hasMore = (searchData.paging?.total ?? 0) > offset + limit;
    return { products, hasMore };
  }

  async updateStock(accessToken: string, itemId: string, quantity: number): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/items/${itemId}?access_token=${accessToken}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available_quantity: quantity }),
    });
    if (!res.ok) {
      this.logger.error(`mercadolivre.updateStock failed: item=${itemId} status=${res.status}`);
      return false;
    }
    return true;
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const res = await fetch(`${BASE_URL}/users/me?access_token=${accessToken}`);
    if (!res.ok) {
      throw new Error(`mercadolivre.getSellerInfo failed: ${res.status}`);
    }
    const data: any = await res.json();
    return { sellerId: String(data.id), name: data.nickname ?? "" };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}
