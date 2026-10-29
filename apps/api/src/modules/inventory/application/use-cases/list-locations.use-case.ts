import { Injectable } from "@nestjs/common";
import { INVENTORY_LOCATION_REPOSITORY, type InventoryLocationRepositoryPort } from "../../domain/ports/inventory-location-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class ListLocationsUseCase {
  constructor(@Inject(INVENTORY_LOCATION_REPOSITORY) private repo: InventoryLocationRepositoryPort) {}

  async execute(merchantId: string) {
    return this.repo.list(merchantId);
  }
}
