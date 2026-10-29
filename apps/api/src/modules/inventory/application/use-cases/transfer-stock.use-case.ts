import { Injectable } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort } from "../../domain/ports/inventory-movement-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class TransferStockUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY) private invRepo: InventoryRepositoryPort,
    @Inject(INVENTORY_MOVEMENT_REPOSITORY) private movementRepo: InventoryMovementRepositoryPort,
  ) {}

  async execute(data: {
    merchantId: string;
    itemId: string;
    quantity: number;
    fromLocationId: string;
    toLocationId: string;
    reason?: string;
    actorUserId?: string;
  }) {
    const item = await this.invRepo.findById(data.merchantId, data.itemId);
    if (!item) throw new Error("Item not found");

    await this.movementRepo.record({
      merchantId: data.merchantId,
      itemId: data.itemId,
      kind: "TRANSFER_OUT",
      quantity: data.quantity,
      reason: data.reason ?? "Internal transfer",
      source: "native",
      actorUserId: data.actorUserId,
    });

    await this.movementRepo.record({
      merchantId: data.merchantId,
      itemId: data.itemId,
      kind: "TRANSFER_IN",
      quantity: data.quantity,
      reason: data.reason ?? "Internal transfer",
      source: "native",
      actorUserId: data.actorUserId,
    });

    return this.invRepo.findById(data.merchantId, data.itemId);
  }
}
