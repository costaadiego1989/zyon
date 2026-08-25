import { Injectable, Inject, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import type { InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import type { InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import type { InventoryLocationRepositoryPort } from "../../domain/ports/inventory-location-repository.port.js";
import { INVENTORY_REPOSITORY } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY } from "../../domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_LOCATION_REPOSITORY } from "../../domain/ports/inventory-location-repository.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Listens to "product.upserted" events from the catalog module.
 * Automatically creates/updates InventoryItem for each variant with a SKU.
 *
 * This ensures that when a merchant creates or edits a product in the catalog,
 * the inventory dashboard reflects the stock immediately — no ERP needed.
 */
@Injectable()
export class OnCatalogProductSavedHandler implements OnModuleInit {
  private readonly logger = new Logger(OnCatalogProductSavedHandler.name);

  constructor(
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus | undefined,
    @Inject(INVENTORY_REPOSITORY) private readonly inventoryRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private readonly movementRepo: InventoryMovementRepositoryPort,
    @Inject(INVENTORY_LOCATION_REPOSITORY) private readonly locationRepo: InventoryLocationRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit() {
    this.eventBus?.subscribe("product.upserted", async (event) => {
      await this.handle(event.merchantId, event.payload);
    }, "inventory:catalog-sync");
  }

  async handle(merchantId: string, payload: unknown): Promise<void> {
    const data = payload as { id?: string; name?: string } | undefined;
    if (!data?.id) return;

    try {
      // Fetch product with variants + stock + price from DB
      const product = await this.prisma.product.findUnique({
        where: { id: data.id },
        include: { variants: { include: { stock: true, price: true } } },
      });

      if (!product || product.merchantId !== merchantId) return;

      // Ensure default location
      const locations = await this.locationRepo.list(merchantId);
      let defaultLoc = locations.find((l) => l.isDefault);
      if (!defaultLoc) {
        defaultLoc = await this.locationRepo.create(merchantId, {
          name: "Estoque principal",
          kind: "warehouse",
          isDefault: true,
        });
      }

      // Sync each variant to inventory
      for (const variant of product.variants) {
        if (!variant.sku) continue;

        const stockRow = variant.stock?.[0];
        const newQty = stockRow?.quantity ?? 0;
        const costInCents = variant.price?.costInCents ?? undefined;
        const variantName = (variant.attributes as Record<string, string>)?.size || (variant.attributes as Record<string, string>)?.color || undefined;

        const existing = await this.inventoryRepo.findBySku(merchantId, variant.sku, defaultLoc.id);
        const previousQty = existing?.quantity ?? 0;

        await this.inventoryRepo.upsert(merchantId, {
          sku: variant.sku,
          productName: product.name,
          variantName,
          locationId: defaultLoc.id,
          quantity: newQty,
          avgCostCents: costInCents,
        });

        // Record movement if qty changed
        const delta = newQty - previousQty;
        if (delta !== 0 && existing) {
          const item = await this.inventoryRepo.findBySku(merchantId, variant.sku, defaultLoc.id);
          if (item) {
            await this.movementRepo.record({
              merchantId,
              itemId: item.id,
              kind: delta > 0 ? "ENTRY" : "ADJUSTMENT",
              quantity: delta,
              reason: "Atualização do catálogo",
              source: "catalog",
            });
          }
        } else if (!existing && newQty > 0) {
          const item = await this.inventoryRepo.findBySku(merchantId, variant.sku, defaultLoc.id);
          if (item) {
            await this.movementRepo.record({
              merchantId,
              itemId: item.id,
              kind: "ENTRY",
              quantity: newQty,
              reason: "Cadastro de produto",
              source: "catalog",
            });
          }
        }
      }

      this.logger.debug(`catalog→inventory sync: ${product.variants.length} variants for product ${data.id}`);
    } catch (err) {
      this.logger.warn(`catalog→inventory sync failed`, {
        merchantId,
        productId: data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
