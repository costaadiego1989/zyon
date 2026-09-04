import { Injectable } from "@nestjs/common";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort, type MovementListFilter } from "../../domain/ports/inventory-movement-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class ListMovementsUseCase {
  constructor(@Inject(INVENTORY_MOVEMENT_REPOSITORY) private repo: InventoryMovementRepositoryPort) {}

  async execute(filter: MovementListFilter) {
    return this.repo.list(filter);
  }
}
