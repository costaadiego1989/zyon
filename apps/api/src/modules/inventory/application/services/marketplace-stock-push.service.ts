import { Injectable, Inject, Logger } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import type { ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import type { InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { ERP_REPOSITORY } from "../../domain/ports/erp-repository.port.js";
import { INVENTORY_REPOSITORY } from "../../domain/ports/inventory-repository.port.js";
import { createMarketplaceAdapter, isMarketplaceProvider } from "../../infrastructure/adapters/marketplace-adapter.factory.js";
import { decryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

/**
 * After a sale, pushes updated stock levels to all connected marketplaces.
 * Fire-and-forget: errors logged, not thrown.
 *
 * Flow:
 * 1. Load all active marketplace connections for merchant
 * 2. For each connected marketplace:
 *    - Decrypt access token
 *    - For each sold item: resolve external item ID, call updateStock(newQty)
 * 3. Log results
 */
@Injectable()
export class MarketplaceStockPushService {
  private readonly logger = new Logger(MarketplaceStockPushService.name);

  constructor(
    @Inject(ERP_REPOSITORY) private readonly erpRepo: ErpRepositoryPort,
    @Inject(INVENTORY_REPOSITORY) private readonly inventoryRepo: InventoryRepositoryPort,
  ) {}

  async pushAfterSale(event: SaleCompletedEvent): Promise<void> {
    try {
      // Find all marketplace connections for this merchant
      const connections = await this.erpRepo.list(event.merchantId);
      const marketplaceConnections = connections.filter(
        (c) => isMarketplaceProvider(c.provider) && c.status === "connected" && c.accessTokenCipher,
      );

      if (marketplaceConnections.length === 0) return;

      for (const conn of marketplaceConnections) {
        const adapter = createMarketplaceAdapter(conn.provider);
        if (!adapter) continue;

        let accessToken: string;
        try {
          accessToken = decryptErpSecret(conn.accessTokenCipher!);
        } catch {
          this.logger.warn(`marketplace.push.decrypt_failed`, { merchantId: event.merchantId, provider: conn.provider });
          continue;
        }

        for (const item of event.items) {
          try {
            // Get current inventory quantity (after decrement already happened)
            const invItem = await this.inventoryRepo.findBySku(event.merchantId, item.sku, conn.id);
            // Try default location too
            const currentQty = invItem?.quantity ?? 0;

            // Push new stock level to marketplace
            await adapter.updateStock(accessToken, item.sku, Math.max(0, currentQty));

            this.logger.debug(`marketplace.push.ok`, {
              provider: conn.provider,
              sku: item.sku,
              newQty: currentQty,
            });
          } catch (err) {
            this.logger.warn(`marketplace.push.item_failed`, {
              provider: conn.provider,
              sku: item.sku,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      this.logger.error(`marketplace.push.failed`, {
        merchantId: event.merchantId,
        orderId: event.orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
