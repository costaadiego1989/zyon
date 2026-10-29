import { Injectable } from "@nestjs/common";
import { INVENTORY_ALERT_REPOSITORY, type InventoryAlertRepositoryPort } from "../../domain/ports/inventory-alert-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class ListAlertsUseCase {
  constructor(@Inject(INVENTORY_ALERT_REPOSITORY) private repo: InventoryAlertRepositoryPort) {}

  async execute(merchantId: string, acknowledged?: boolean) {
    return this.repo.list(merchantId, acknowledged);
  }
}
