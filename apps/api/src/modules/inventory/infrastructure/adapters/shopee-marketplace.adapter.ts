import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { MarketplaceProviderPort, MarketplaceProduct } from "../../domain/ports/marketplace-provider.port.js";

const BASE_URL = "https://partner.shopeemobile.com";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

/**
 * Shopee marketplace adapter.
 * OAuth 2.0 + HMAC-SHA256 request signing.
 */
@Injectable()
export class ShopeeMarketplaceAdapter implements MarketplaceProviderPort {
  private readonly logger = new Logger(ShopeeMarketplaceAdapter.name);

  async listProducts(accessToken: string, page = 0): Promise<{ products: MarketplaceProduct[]; hasMore: boolean }> {
    const pageSize = 50;
    const offset = page * pageSize;
    const path = "/api/v2/product/get_item_list";
    const params: Record<string, string> = {
      offset: String(offset),
      page_size: String(pageSize),
      item_status: "NORMAL",
    };

    const url = this.buildSignedUrl(path, accessToken, params);
    const res = await fetch(url);
    if (!res.ok) {
      this.logger.error(`shopee.listProducts failed: ${res.status}`);
      return { products: [], hasMore: false };
    }

    const data: any = await res.json();
    const items: any[] = data.response?.item ?? [];
    const hasMore = data.response?.has_next_page ?? false;

    const products: MarketplaceProduct[] = items.map((item) => ({
      id: String(item.item_id),
      title: item.item_name ?? "",
      sku: item.item_sku ?? undefined,
      stock: item.stock_info_v2?.summary_info?.total_available_stock ?? 0,
    }));

    return { products, hasMore };
  }

  async updateStock(accessToken: string, itemId: string, quantity: number): Promise<boolean> {
    const path = "/api/v2/product/update_stock";
    const body = JSON.stringify({
      item_id: Number(itemId),
      stock_list: [{ model_id: 0, normal_stock: quantity }],
    });

    const url = this.buildSignedUrl(path, accessToken, {}, body);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      this.logger.error(`shopee.updateStock failed: item=${itemId} status=${res.status}`);
      return false;
    }
    const result: any = await res.json();
    if (result.error) {
      this.logger.error(`shopee.updateStock error: ${result.error} ${result.message}`);
      return false;
    }
    return true;
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const path = "/api/v2/shop/get_shop_info";
    const url = this.buildSignedUrl(path, accessToken);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`shopee.getSellerInfo failed: ${res.status}`);
    }
    const data: any = await res.json();
    return {
      sellerId: String(data.response?.shop_id ?? ""),
      name: data.response?.shop_name ?? "",
    };
  }

  // --- HMAC Signing ---

  private buildSignedUrl(
    path: string,
    accessToken: string,
    extraParams: Record<string, string> = {},
    _body?: string,
  ): string {
    const partnerId = env("SHOPEE_PARTNER_ID");
    const partnerKey = env("SHOPEE_PARTNER_KEY");
    const timestamp = Math.floor(Date.now() / 1000);

    const sign = this.computeSign(partnerId, path, timestamp, accessToken, partnerKey);

    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      access_token: accessToken,
      sign,
      ...extraParams,
    });

    return `${BASE_URL}${path}?${params.toString()}`;
  }

  private computeSign(
    partnerId: string,
    path: string,
    timestamp: number,
    accessToken: string,
    partnerKey: string,
  ): string {
    const baseString = `${partnerId}${path}${timestamp}${accessToken}`;
    return createHmac("sha256", partnerKey).update(baseString).digest("hex");
  }
}
