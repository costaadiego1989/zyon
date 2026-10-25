import { Injectable } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort, type InventoryListFilter } from "../../domain/ports/inventory-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class ListInventoryUseCase {
  constructor(@Inject(INVENTORY_REPOSITORY) private repo: InventoryRepositoryPort) {}

  async execute(filter: InventoryListFilter) {
    return this.repo.list(filter);
  }
}
