import type { AppliedInventorySale, SaleCompletedEvent } from "../events/sale-completed.event.js";

export const INVENTORY_SALE_REPOSITORY = Symbol("INVENTORY_SALE_REPOSITORY");
export interface InventorySaleRepositoryPort {
  apply(event: SaleCompletedEvent): Promise<AppliedInventorySale>;
  findReceipt(merchantId: string, receiptId: string): Promise<AppliedInventorySale | undefined>;
}
