import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import type { StockRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";

/**
 * Reconciles catalog ProductStock against the InventoryItem ledger.
 *
 * Single responsibility: for each ledger item whose catalog quantity differs,
 * set the catalog quantity to the ledger value (InventoryItem = source of truth)
 * and record an ADJUSTMENT movement documenting the correction. This is the
 * safety net for rare partial failures — primary consistency comes from
 * projecting the same order.completed decrement onto both stores.
 *
 * Scheduling and worker lifecycle live in separate files (see the scheduler and
 * worker); this use-case only knows how to run one sweep.
 */
@Injectable()
export class ReconcileCatalogStockUseCase {
  private readonly logger = new Logger(ReconcileCatalogStockUseCase.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly invRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private readonly movementRepo: InventoryMovementRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject("StockRepositoryPort") private readonly catalogStock?: StockRepositoryPort,
  ) {}

  /** Runs one reconciliation sweep. Returns how many catalog rows were corrected. */
  async execute(): Promise<number> {
    if (!this.catalogStock) return 0;

    // Enumerate merchants that have inventory, then reconcile each.
    const merchants = await this.prisma.inventoryItem.findMany({
      distinct: ["merchantId"],
      select: { merchantId: true },
    });

    const items: Array<{ merchantId: string; sku: string; quantity: number; locationId: string }> = [];
    for (const { merchantId } of merchants) {
      const page = await this.invRepo
        .list({ merchantId, pageSize: 1000 } as never)
        .catch(() => ({ items: [], total: 0 }));
      for (const it of page.items) {
        items.push({ merchantId: it.merchantId, sku: it.sku, quantity: it.quantity, locationId: it.locationId });
      }
    }

    let corrected = 0;
    for (const item of items) {
      try {
        const catalog = await this.catalogStock.getStockBySku(item.merchantId, item.sku);
        if (!catalog) continue; // sku not in catalog (marketplace-only, etc.)
        if (catalog.quantity === item.quantity) continue;

        const res = await this.catalogStock.setQuantityBySku(item.merchantId, item.sku, item.quantity);
        if (!res.ok) continue;

        const delta = item.quantity - catalog.quantity;
        const invItem = await this.invRepo.findBySku(item.merchantId, item.sku, item.locationId);
        if (invItem) {
          await this.movementRepo.record({
            merchantId: item.merchantId,
            itemId: invItem.id,
            kind: "ADJUSTMENT",
            quantity: delta,
            reason: "reconciliation",
            source: "reconciliation",
          });
        }
        corrected++;
        this.logger.log(`Reconciled catalog stock: merchant=${item.merchantId} sku=${item.sku} ${catalog.quantity}→${item.quantity}`);
      } catch (err) {
        this.logger.warn(`Reconcile failed for sku=${item.sku}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (corrected > 0) this.logger.log(`Reconciliation corrected ${corrected} catalog stock row(s)`);
    return corrected;
  }
}
