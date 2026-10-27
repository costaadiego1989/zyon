import { Injectable, Inject } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_LOCATION_REPOSITORY, type InventoryLocationRepositoryPort } from "../../domain/ports/inventory-location-repository.port.js";

@Injectable()
export class CreateInventoryItemUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private readonly invRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private readonly movementRepo: InventoryMovementRepositoryPort,
    @Inject(INVENTORY_LOCATION_REPOSITORY) private readonly locationRepo: InventoryLocationRepositoryPort,
  ) {}

  async execute(input: {
    merchantId: string;
    sku: string;
    productName: string;
    variantName?: string;
    locationId?: string;
    quantity: number;
    avgCostCents?: number;
    lowStockThreshold?: number;
    actorUserId?: string;
  }) {
    // Ensure default location exists
    let locationId = input.locationId;
    if (!locationId) {
      const locations = await this.locationRepo.list(input.merchantId);
      let defaultLoc = locations.find(l => l.isDefault);
      if (!defaultLoc) {
        defaultLoc = await this.locationRepo.create(input.merchantId, {
          name: "Estoque principal",
          kind: "warehouse",
          isDefault: true,
        });
      }
      locationId = defaultLoc.id;
    }

    // Create/update inventory item
    const item = await this.invRepo.upsert(input.merchantId, {
      sku: input.sku,
      productName: input.productName,
      variantName: input.variantName,
      locationId,
      quantity: input.quantity,
      avgCostCents: input.avgCostCents,
    });

    // Set threshold if provided
    if (input.lowStockThreshold != null) {
      await this.invRepo.setLowStockThreshold(input.merchantId, item.id, input.lowStockThreshold);
    }

    // Record initial entry movement if quantity > 0
    if (input.quantity > 0) {
      await this.movementRepo.record({
        merchantId: input.merchantId,
        itemId: item.id,
        kind: "ENTRY",
        quantity: input.quantity,
        reason: "Estoque inicial",
        source: "native",
        actorUserId: input.actorUserId,
      });
    }

    return item;
  }
}
