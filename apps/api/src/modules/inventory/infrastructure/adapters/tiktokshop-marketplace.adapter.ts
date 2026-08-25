import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import type { MarketplaceProviderPort, MarketplaceProduct } from "../../domain/ports/marketplace-provider.port.js";

const API_BASE = "https://open-api.tiktokglobalshop.com";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

/**
 * TikTok Shop marketplace adapter.
 * OAuth 2.0 + HMAC-SHA256 request signing on path + sorted params.
 */
@Injectable()
export class TikTokShopMarketplaceAdapter implements MarketplaceProviderPort {
  private readonly logger = new Logger(TikTokShopMarketplaceAdapter.name);

  async listProducts(accessToken: string, page = 0): Promise<{ products: MarketplaceProduct[]; hasMore: boolean }> {
    const pageSize = 50;
    const path = "/api/products/search";
    const params: Record<string, string> = {
      app_key: env("TIKTOKSHOP_APP_KEY"),
      access_token: accessToken,
      page_number: String(page + 1),
      page_size: String(pageSize),
    };

    const url = this.buildSignedUrl(path, params);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      this.logger.error(`tiktokshop.listProducts failed: ${res.status}`);
      return { products: [], hasMore: false };
    }

    const data: any = await res.json();
    const items: any[] = data.data?.products ?? [];
    const total = data.data?.total ?? 0;
    const hasMore = (page + 1) * pageSize < total;

    const products: MarketplaceProduct[] = items.map((item) => ({
      id: String(item.id),
      title: item.name ?? "",
      sku: item.skus?.[0]?.seller_sku ?? undefined,
      stock: item.skus?.[0]?.stock_infos?.[0]?.available_stock ?? 0,
    }));

    return { products, hasMore };
  }

  async updateStock(accessToken: string, itemId: string, quantity: number): Promise<boolean> {
    const path = "/api/products/stocks";
    const params: Record<string, string> = {
      app_key: env("TIKTOKSHOP_APP_KEY"),
      access_token: accessToken,
    };

    const body = JSON.stringify({
      product_id: itemId,
      skus: [{ id: itemId, stock_infos: [{ available_stock: quantity }] }],
    });

    const url = this.buildSignedUrl(path, params);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      this.logger.error(`tiktokshop.updateStock failed: item=${itemId} status=${res.status}`);
      return false;
    }
    const result: any = await res.json();
    if (result.code !== 0) {
      this.logger.error(`tiktokshop.updateStock error: code=${result.code} msg=${result.message}`);
      return false;
    }
    return true;
  }

  async getSellerInfo(accessToken: string): Promise<{ sellerId: string; name: string }> {
    const path = "/api/shop/get_authorized_shop";
    const params: Record<string, string> = {
      app_key: env("TIKTOKSHOP_APP_KEY"),
      access_token: accessToken,
    };

    const url = this.buildSignedUrl(path, params);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`tiktokshop.getSellerInfo failed: ${res.status}`);
    }
    const data: any = await res.json();
    const shops: any[] = data.data?.shops ?? [];
    const shop = shops[0];
    return {
      sellerId: String(shop?.id ?? ""),
      name: shop?.name ?? "",
    };
  }

  // --- HMAC Signing ---

  private buildSignedUrl(path: string, params: Record<string, string>): string {
    const appSecret = env("TIKTOKSHOP_APP_SECRET");
    const timestamp = Math.floor(Date.now() / 1000);
    params["timestamp"] = String(timestamp);

    const sign = this.computeSign(path, params, appSecret);
    params["sign"] = sign;

    const qs = new URLSearchParams(params).toString();
    return `${API_BASE}${path}?${qs}`;
  }

  private computeSign(path: string, params: Record<string, string>, appSecret: string): string {
    // TikTok sign: HMAC-SHA256(app_secret, path + sorted key=value pairs)
    const sortedKeys = Object.keys(params)
      .filter((k) => k !== "sign" && k !== "access_token")
      .sort();
    const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join("");
    const baseString = `${path}${paramString}`;
    return createHmac("sha256", appSecret).update(baseString).digest("hex");
  }
}
