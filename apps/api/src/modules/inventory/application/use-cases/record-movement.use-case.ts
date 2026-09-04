import { Injectable } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_ALERT_REPOSITORY, type InventoryAlertRepositoryPort } from "../../domain/ports/inventory-alert-repository.port.js";
import { computeStockStatus } from "../../domain/values/stock-status.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class RecordMovementUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private invRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private movementRepo: InventoryMovementRepositoryPort,
    @Inject(INVENTORY_ALERT_REPOSITORY) private alertRepo: InventoryAlertRepositoryPort,
  ) {}

  async execute(data: {
    merchantId: string;
    itemId: string;
    kind: string;
    quantity: number;
    reason?: string;
    externalRef?: string;
    source?: string;
    actorUserId?: string;
  }) {
    const item = await this.invRepo.findById(data.merchantId, data.itemId);
    if (!item) throw new Error("Item not found");

    const sign = this.getMovementSign(data.kind);
    const newItem = await this.invRepo.adjustQuantity(data.merchantId, data.itemId, sign * data.quantity);

    await this.movementRepo.record(data);

    const available = newItem.quantity - newItem.reserved;
    const status = computeStockStatus(newItem.quantity, newItem.reserved, newItem.lowStockThreshold);
    if (status === "low_stock") {
      const exists = await this.alertRepo.existsOpen(data.merchantId, data.itemId, "low_stock");
      if (!exists) {
        await this.alertRepo.create({
          merchantId: data.merchantId,
          itemId: data.itemId,
          severity: "warning",
          message: `Estoque baixo: ${available} unidades disponíveis`,
        });
      }
    }

    return newItem;
  }

  private getMovementSign(kind: string): number {
    const add = ["ENTRY", "ADJUSTMENT_POSITIVE", "RELEASE", "TRANSFER_IN"];
    return add.includes(kind) ? 1 : -1;
  }
}
