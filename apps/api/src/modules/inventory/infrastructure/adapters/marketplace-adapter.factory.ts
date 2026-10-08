import { MercadoLivreMarketplaceAdapter } from "./mercadolivre-marketplace.adapter.js";
import { ShopeeMarketplaceAdapter } from "./shopee-marketplace.adapter.js";
import { TikTokShopMarketplaceAdapter } from "./tiktokshop-marketplace.adapter.js";
import type { MarketplaceProviderPort } from "../../domain/ports/marketplace-provider.port.js";

const MARKETPLACE_PROVIDERS = ["mercadolivre", "shopee", "tiktokshop"] as const;

export function isMarketplaceProvider(provider: string): boolean {
  return (MARKETPLACE_PROVIDERS as readonly string[]).includes(provider);
}

export function createMarketplaceAdapter(provider: string, config: Record<string, unknown> = {}): MarketplaceProviderPort | null {
  switch (provider) {
    case "mercadolivre": return new MercadoLivreMarketplaceAdapter();
    case "shopee": return new ShopeeMarketplaceAdapter();
    case "tiktokshop": return new TikTokShopMarketplaceAdapter(config);
    default: return null;
  }
}
