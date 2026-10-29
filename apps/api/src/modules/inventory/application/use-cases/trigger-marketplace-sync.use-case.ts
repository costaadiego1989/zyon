import { Injectable, Inject, Logger } from "@nestjs/common";
import type { InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import type { InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import type { InventoryLocationRepositoryPort } from "../../domain/ports/inventory-location-repository.port.js";
import type { ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import { INVENTORY_REPOSITORY } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY } from "../../domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_LOCATION_REPOSITORY } from "../../domain/ports/inventory-location-repository.port.js";
import { ERP_REPOSITORY } from "../../domain/ports/erp-repository.port.js";
import { TIKTOKSHOP_TOKEN_PORT, type TikTokShopTokenPort } from "../../domain/ports/tiktokshop-token.port.js";
import { SHOPEE_TOKEN_PORT, type ShopeeTokenPort } from "../../domain/ports/shopee-token.port.js";
import { createMarketplaceAdapter, isMarketplaceProvider } from "../../infrastructure/adapters/marketplace-adapter.factory.js";

export interface TriggerMarketplaceSyncInput {
  merchantId: string;
  provider: string;
  accessToken: string;
  connectionId?: string;
}

export interface TriggerMarketplaceSyncResult {
  synced: boolean;
  productsImported: number;
  errors: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  mercadolivre: "Mercado Livre",
  shopee: "Shopee",
  tiktokshop: "TikTok Shop",
};

@Injectable()
export class TriggerMarketplaceSyncUseCase {
  private readonly logger = new Logger(TriggerMarketplaceSyncUseCase.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly inventoryRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private readonly movementRepo: InventoryMovementRepositoryPort,
    @Inject(INVENTORY_LOCATION_REPOSITORY) private readonly locationRepo: InventoryLocationRepositoryPort,
    @Inject(ERP_REPOSITORY) private readonly erpRepo: ErpRepositoryPort,
    @Inject(TIKTOKSHOP_TOKEN_PORT) private readonly tiktokTokens: TikTokShopTokenPort,
    @Inject(SHOPEE_TOKEN_PORT) private readonly shopeeTokens?: ShopeeTokenPort,
  ) {}

  async execute(input: TriggerMarketplaceSyncInput): Promise<TriggerMarketplaceSyncResult> {
    const { merchantId, provider, accessToken, connectionId } = input;

    if (!isMarketplaceProvider(provider)) {
      throw new Error(`provider_not_supported_for_product_sync:${provider}`);
    }

    const managedConnection = (provider === "tiktokshop" || provider === "shopee") && connectionId
      ? await this.erpRepo.findByProvider(merchantId, provider) : null;
    if (provider === "shopee" && (!managedConnection || managedConnection.id !== connectionId || managedConnection.status !== "connected")) throw new Error("shopee_connection_missing");
    const providerAccessToken = provider === "tiktokshop" && connectionId
      ? await this.tiktokTokens.getValidAccessToken(merchantId, connectionId)
      : provider === "shopee" && connectionId && this.shopeeTokens
        ? await this.shopeeTokens.getValidAccessToken(merchantId, connectionId) : accessToken;
    const adapter = createMarketplaceAdapter(provider, managedConnection?.config ?? {});
    if (!adapter) {
      throw new Error(`adapter_not_found:${provider}`);
    }

    // Get or create location for this marketplace
    const locationName = PROVIDER_LABELS[provider] ?? provider;
    const locations = await this.locationRepo.list(merchantId);
    let location = locations.find((l) => l.name === locationName);
    if (!location) {
      location = await this.locationRepo.create(merchantId, { name: locationName, kind: "marketplace" });
    }
    if (managedConnection && managedConnection.id === connectionId) {
      await this.erpRepo.upsert(merchantId, provider, {
        status: managedConnection.status,
        config: { ...managedConnection.config, inventoryLocationId: location.id },
      });
    }

    let imported = 0;
    let errors = 0;
    let page = 0;
    let hasMore = true;

    this.logger.log(`marketplace.sync.start`, { merchantId, provider });

    while (hasMore) {
      try {
        const result = await adapter.listProducts(providerAccessToken, page);
        hasMore = result.hasMore;

        for (const product of result.products) {
          try {
            const sku = product.sku || product.id;
            const previous = provider === "shopee" ? await this.inventoryRepo.findBySku(merchantId, sku, location.id) : null;
            if (provider === "shopee" && previous && product.stock < previous.reserved) throw new Error("shopee_stock_below_local_reservations");
            const item = await this.inventoryRepo.upsert(merchantId, {
              sku,
              productName: product.title,
              locationId: location.id,
              quantity: product.stock,
            });

            if (provider !== "shopee" || product.stock !== (previous?.quantity ?? 0)) await this.movementRepo.record({
              merchantId,
              itemId: item.id,
              kind: provider === "shopee" ? "ADJUSTMENT" : "ENTRY",
              quantity: provider === "shopee" ? product.stock - (previous?.quantity ?? 0) : product.stock,
              reason: "Sync inicial",
              source: `marketplace:${provider}`,
              externalRef: product.id,
            });

            imported++;
          } catch (err) {
            errors++;
            this.logger.warn(`marketplace.sync.product_error`, {
              merchantId,
              provider,
              productId: product.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        page++;
      } catch (err) {
        if (provider === "tiktokshop" || provider === "shopee") errors++;
        this.logger.error(`marketplace.sync.page_error`, {
          merchantId,
          provider,
          page,
          error: err instanceof Error ? err.message : String(err),
        });
        hasMore = false;
      }
    }

    // Mark connection as synced
    if (connectionId) {
      try {
        if ((provider === "tiktokshop" || provider === "shopee") && errors > 0) {
          await this.erpRepo.markError(merchantId, connectionId, `${provider}_sync_failed`);
        } else {
          await this.erpRepo.markSynced(merchantId, connectionId);
        }
      } catch (_) { /* non-fatal */ }
    }

    this.logger.log(`marketplace.sync.complete`, { merchantId, provider, imported, errors });

    return { synced: provider === "tiktokshop" || provider === "shopee" ? errors === 0 : true, productsImported: imported, errors };
  }
}
