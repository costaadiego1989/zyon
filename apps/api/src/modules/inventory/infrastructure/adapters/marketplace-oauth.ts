import type { MarketplaceContext } from "../../domain/ports/marketplace-provider.port.js";
import { marketplaceId, marketplaceJson, requiredMarketplaceEnv, shopeeNumericId, shopeeSignedUrl } from "./marketplace-api.js";

export interface MarketplaceTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  context: MarketplaceContext;
}

function tokens(raw: any, expiresAt: Date, context: MarketplaceContext): MarketplaceTokens {
  if (typeof raw.access_token !== "string" || !raw.access_token || typeof raw.refresh_token !== "string" || !raw.refresh_token) throw new Error("erp_token_failed");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error("erp_token_expiry_invalid");
  return { accessToken: raw.access_token, refreshToken: raw.refresh_token, expiresAt, context };
}

export async function exchangeMarketplaceToken(provider: string, code: string, shopId?: string, mainAccountId?: string): Promise<MarketplaceTokens> {
  if (provider === "mercadolivre") {
    const raw = await marketplaceJson(provider, "https://api.mercadolibre.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code,
        client_id: requiredMarketplaceEnv("MERCADOLIVRE_APP_ID"), client_secret: requiredMarketplaceEnv("MERCADOLIVRE_CLIENT_SECRET"), redirect_uri: requiredMarketplaceEnv("MERCADOLIVRE_REDIRECT_URI"),
      }).toString(),
    });
    return tokens(raw, new Date(Date.now() + Number(raw.expires_in) * 1000), { sellerId: marketplaceId(raw.user_id) });
  }
  if (provider === "shopee") {
    if (!shopId && !mainAccountId) throw new Error("erp_shopee_shop_id_missing");
    const raw = await marketplaceJson(provider, shopeeSignedUrl("/api/v2/auth/token/get"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partner_id: shopeeNumericId(requiredMarketplaceEnv("SHOPEE_PARTNER_ID")), code,
        ...(shopId ? { shop_id: shopeeNumericId(shopId) } : { main_account_id: shopeeNumericId(mainAccountId) }),
      }),
    });
    const selectedShop = shopId ?? (raw.shop_id_list?.length === 1 ? String(raw.shop_id_list[0]) : undefined);
    if (!selectedShop) throw new Error("erp_shop_selection_required");
    if (raw.shop_id_list?.length && !raw.shop_id_list.map(String).includes(selectedShop)) throw new Error("erp_marketplace_account_mismatch");
    return tokens(raw, new Date(Date.now() + Number(raw.expire_in) * 1000), { shopId: String(shopeeNumericId(selectedShop)) });
  }
  if (provider === "tiktokshop") {
    const params = new URLSearchParams({ app_key: requiredMarketplaceEnv("TIKTOKSHOP_APP_KEY"), app_secret: requiredMarketplaceEnv("TIKTOKSHOP_APP_SECRET"), auth_code: code, grant_type: "authorized_code" });
    const raw = await marketplaceJson(provider, `https://auth.tiktok-shops.com/api/v2/token/get?${params}`);
    if (![0, 4, 5].includes(Number(raw.data?.user_type))) throw new Error("erp_marketplace_seller_required");
    // TikTok returns an absolute Unix timestamp, unlike ML/Shopee durations.
    return tokens(raw.data, new Date(Number(raw.data.access_token_expire_in) * 1000), {});
  }
  throw new Error("erp_provider_not_supported");
}

export async function refreshMarketplaceToken(provider: string, refreshToken: string, context: MarketplaceContext): Promise<MarketplaceTokens> {
  if (provider === "mercadolivre") {
    const raw = await marketplaceJson(provider, "https://api.mercadolibre.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: requiredMarketplaceEnv("MERCADOLIVRE_APP_ID"), client_secret: requiredMarketplaceEnv("MERCADOLIVRE_CLIENT_SECRET") }).toString(),
    });
    if (marketplaceId(raw.user_id) !== context.sellerId) throw new Error("erp_marketplace_account_mismatch");
    return tokens(raw, new Date(Date.now() + Number(raw.expires_in) * 1000), context);
  }
  if (provider === "shopee") {
    const raw = await marketplaceJson(provider, shopeeSignedUrl("/api/v2/auth/access_token/get"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partner_id: shopeeNumericId(requiredMarketplaceEnv("SHOPEE_PARTNER_ID")), refresh_token: refreshToken, shop_id: shopeeNumericId(context.shopId) }),
    });
    if (raw.shop_id !== undefined && String(raw.shop_id) !== context.shopId) throw new Error("erp_marketplace_account_mismatch");
    return tokens(raw, new Date(Date.now() + Number(raw.expire_in) * 1000), context);
  }
  if (provider === "tiktokshop") {
    const params = new URLSearchParams({ app_key: requiredMarketplaceEnv("TIKTOKSHOP_APP_KEY"), app_secret: requiredMarketplaceEnv("TIKTOKSHOP_APP_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" });
    const raw = await marketplaceJson(provider, `https://auth.tiktok-shops.com/api/v2/token/refresh?${params}`);
    return tokens(raw.data, new Date(Number(raw.data?.access_token_expire_in) * 1000), context);
  }
  throw new Error("erp_provider_not_supported");
}

export function marketplaceContext(config: unknown): MarketplaceContext {
  const raw = config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {};
  return Object.fromEntries(["sellerId", "shopId", "shopCipher", "sellerName"].filter(key => typeof raw[key] === "string").map(key => [key, raw[key]]));
}
