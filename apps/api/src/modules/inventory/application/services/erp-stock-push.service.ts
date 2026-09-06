import { Injectable, Optional, Inject } from "@nestjs/common";
import type { AppliedInventorySale } from "../../domain/events/sale-completed.event.js";
export const ERP_STOCK_PUSH_PORT = Symbol("ERP_STOCK_PUSH_PORT");

export interface ErpStockPushPort {
  /** Set absolute quantity; implementation must deduplicate this operation key. */
  pushStockLevel(merchantId: string, sku: string, quantity: number, location: string,
    options: { idempotencyKey: string }): Promise<void>;
}

@Injectable()
export class ErpStockPushService {
  constructor(@Optional() @Inject(ERP_STOCK_PUSH_PORT) private readonly erpAdapter?: ErpStockPushPort) {}
  async pushStock(sale: AppliedInventorySale): Promise<void> {
    if (!this.erpAdapter) throw new Error("inventory_erp_adapter_unavailable");
    for (const item of sale.items) {
      await this.erpAdapter.pushStockLevel(sale.event.merchantId, item.sku, item.remainingQuantity,
        item.locationId, { idempotencyKey: `${sale.receiptId}:${item.itemId}` });
    }
  }
}
