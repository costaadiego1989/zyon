import { Injectable } from "@nestjs/common";
import type { AppliedInventorySale } from "../../domain/events/sale-completed.event.js";
import { ErpSyncService } from "./erp-sync.service.js";

/** Legacy entrypoint delegates to the same receipt-deduplicated durable queue. */
@Injectable()
export class MarketplaceStockPushService {
  constructor(private readonly sync: ErpSyncService) {}

  async pushAfterSale(sale: AppliedInventorySale): Promise<void> {
    await this.sync.enqueueSale(sale);
  }
}
