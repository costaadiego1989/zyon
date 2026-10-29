import { Injectable } from "@nestjs/common";
import { INVENTORY_ALERT_REPOSITORY, type InventoryAlertRepositoryPort } from "../../domain/ports/inventory-alert-repository.port.js";
import { Inject } from "@nestjs/common";

@Injectable()
export class AcknowledgeAlertUseCase {
  constructor(@Inject(INVENTORY_ALERT_REPOSITORY) private repo: InventoryAlertRepositoryPort) {}

  async execute(merchantId: string, alertId: string) {
    return this.repo.acknowledge(merchantId, alertId);
  }
}
