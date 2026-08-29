import { Injectable, Logger, Inject } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_ALERT_REPOSITORY, type InventoryAlertRepositoryPort } from "../../domain/ports/inventory-alert-repository.port.js";
import { INVENTORY_LOCATION_REPOSITORY, type InventoryLocationRepositoryPort } from "../../domain/ports/inventory-location-repository.port.js";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { computeStockStatus } from "../../domain/values/stock-status.js";

/**
 * Handles sale.completed events: finds inventory items by (merchantId, sku),
 * records EXIT movements, adjusts quantities, and creates low-stock alerts if needed.
 */
@Injectable()
export class OnSaleCompletedHandler {
  private readonly logger = new Logger(OnSaleCompletedHandler.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly invRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private readonly movementRepo: InventoryMovementRepositoryPort,
    @Inject(INVENTORY_ALERT_REPOSITORY) private readonly alertRepo: InventoryAlertRepositoryPort,
    @Inject(INVENTORY_LOCATION_REPOSITORY) private readonly locationRepo: InventoryLocationRepositoryPort,
  ) {}

  async handle(event: SaleCompletedEvent): Promise<void> {
    const { merchantId, orderId, items } = event;

    // Resolve the merchant's default inventory location. The InventoryItem
    // snapshot created by the catalog→inventory sync lives at the isDefault
    // location (a cuid), never the literal string "default" — using the latter
    // meant findBySku always missed and stock never decremented on a sale.
    const locations = await this.locationRepo.list(merchantId);
    const defaultLocationId = (locations.find((l) => l.isDefault) ?? locations[0])?.id;
    if (!defaultLocationId) {
      this.logger.warn(`No inventory location for merchant ${merchantId}; skipping stock decrement for order ${orderId}`);
      return;
    }

    for (const item of items) {
      try {
        // Find inventory item by merchant + sku + location
        const invItem = await this.invRepo.findBySku(merchantId, item.sku, defaultLocationId);
        if (!invItem) {
          this.logger.warn(`Inventory item not found: merchantId=${merchantId}, sku=${item.sku}, location=${defaultLocationId}`);
          continue;
        }

        // Record EXIT movement
        await this.movementRepo.record({
          merchantId,
          itemId: invItem.id,
          kind: "EXIT",
          quantity: item.quantity,
          reason: "sale_completed",
          externalRef: orderId,
          source: "commerce",
          actorUserId: undefined
        });

        // Adjust quantity
        const newItem = await this.invRepo.adjustQuantity(merchantId, invItem.id, -item.quantity);

        const available = newItem.quantity - newItem.reserved;
        const status = computeStockStatus(newItem.quantity, newItem.reserved, newItem.lowStockThreshold);

        // Create low-stock alert if threshold breached
        if (status === "low_stock") {
          const exists = await this.alertRepo.existsOpen(merchantId, invItem.id, "low_stock");
          if (!exists) {
            await this.alertRepo.create({
              merchantId,
              itemId: invItem.id,
              severity: "warning",
              message: `Estoque baixo pós-venda: ${available} unidades disponíveis (SKU: ${item.sku})`
            });
          }
        }

        this.logger.debug(
          `Stock decremented: merchantId=${merchantId}, sku=${item.sku}, quantity=${item.quantity}, new=${newItem.quantity}, available=${available}`
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to decrement stock for sale: ${errorMsg}`, {
          merchantId,
          orderId,
          sku: item.sku,
          quantity: item.quantity,
          error: err instanceof Error ? err.stack : undefined
        });
      }
    }
  }
}

