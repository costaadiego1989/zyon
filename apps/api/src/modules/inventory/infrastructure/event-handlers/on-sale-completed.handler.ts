import { Injectable, Inject } from "@nestjs/common";
import { INVENTORY_SALE_REPOSITORY, type InventorySaleRepositoryPort } from "../../domain/ports/inventory-sale.repository.port.js";
import type { AppliedInventorySale, SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";

@Injectable()
export class OnSaleCompletedHandler {
  constructor(@Inject(INVENTORY_SALE_REPOSITORY) private readonly sales: InventorySaleRepositoryPort) {}
  async handle(event: SaleCompletedEvent): Promise<AppliedInventorySale> {
    return this.sales.apply(event);
  }
}
