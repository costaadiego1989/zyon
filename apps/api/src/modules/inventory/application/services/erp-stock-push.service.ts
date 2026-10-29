import { Injectable } from "@nestjs/common";
import type { AppliedInventorySale } from "../../domain/events/sale-completed.event.js";
import { ErpSyncService } from "./erp-sync.service.js";

@Injectable()
export class ErpStockPushService {
  constructor(private readonly sync: ErpSyncService) {}
  async pushStock(sale: AppliedInventorySale): Promise<void> {
    await this.sync.enqueueSale(sale);
  }
}
