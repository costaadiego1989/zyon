import { Injectable } from "@nestjs/common";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort } from "../../domain/ports/inventory-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class GetDashboardSummaryUseCase {
  constructor(@Inject(INVENTORY_REPOSITORY) private repo: InventoryRepositoryPort) {}

  async execute(merchantId: string) {
    return this.repo.getSummary(merchantId);
  }
}
