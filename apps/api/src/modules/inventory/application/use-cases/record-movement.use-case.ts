import { BadRequestException, Injectable } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_ALERT_REPOSITORY, type InventoryAlertRepositoryPort } from "../../domain/ports/inventory-alert-repository.port.js";
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
    const allowed = ["ENTRY", "EXIT", "ADJUSTMENT", "RELEASE", "TRANSFER_IN", "TRANSFER_OUT"];
    if (!allowed.includes(data.kind) || !Number.isSafeInteger(data.quantity) || data.quantity <= 0 || data.quantity > 2_147_483_647) throw new BadRequestException("invalid_inventory_movement");
    const sign = this.getMovementSign(data.kind);
    if (this.invRepo.recordMovementAtomic) return this.invRepo.recordMovementAtomic(data, sign * data.quantity);
    const item = await this.invRepo.findById(data.merchantId, data.itemId);
    if (!item) throw new Error("Item not found");

    if (item.quantity + sign * data.quantity < item.reserved) throw new BadRequestException("stock_quantity_below_reserved");
    const newItem = await this.invRepo.adjustQuantity(data.merchantId, data.itemId, sign * data.quantity);

    await this.movementRepo.record(data);

    await this.alertRepo.reconcileStock(data.merchantId, data.itemId);

    return newItem;
  }

  private getMovementSign(kind: string): number {
    const add = ["ENTRY", "RELEASE", "TRANSFER_IN"];
    return add.includes(kind) ? 1 : -1;
  }
}
