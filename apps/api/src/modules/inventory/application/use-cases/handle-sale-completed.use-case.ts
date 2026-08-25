import { Injectable, Logger } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { OnSaleCompletedHandler } from "../../infrastructure/event-handlers/on-sale-completed.handler.js";
import { ErpStockPushService } from "../services/erp-stock-push.service.js";
import { InventoryWebhookEmitterService } from "../services/inventory-webhook-emitter.service.js";
import { CrmSyncService } from "../services/crm-sync.service.js";

export type HandleSaleCompletedOutput = {
  stockDecrementedCount: number;
  erpPushed: boolean;
  webhookQueued: boolean;
  crmSynced: boolean;
};

/**
 * Orchestrator use case: coordinates all 4 actions after sale completes.
 *
 * Steps:
 * 1. Decrement stock (via OnSaleCompletedHandler)
 * 2. Push to ERP
 * 3. Emit webhook
 * 4. Sync CRM
 *
 * Each step is independent: one failure does not block others.
 */
@Injectable()
export class HandleSaleCompletedUseCase {
  private readonly logger = new Logger(HandleSaleCompletedUseCase.name);

  constructor(
    private readonly stockHandler: OnSaleCompletedHandler,
    private readonly erpPush: ErpStockPushService,
    private readonly webhookEmitter: InventoryWebhookEmitterService,
    private readonly crmSync: CrmSyncService
  ) {}

  async execute(event: SaleCompletedEvent): Promise<HandleSaleCompletedOutput> {
    const output: HandleSaleCompletedOutput = {
      stockDecrementedCount: 0,
      erpPushed: false,
      webhookQueued: false,
      crmSynced: false
    };

    this.logger.debug(
      `[Sale] Processing: merchantId=${event.merchantId}, orderId=${event.orderId}, items=${event.items.length}`
    );

    // 1. Decrement stock
    try {
      await this.stockHandler.handle(event);
      output.stockDecrementedCount = event.items.length;
      this.logger.debug(`[Sale] Stock decremented: ${event.items.length} items`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Sale] Stock decrement failed: ${errorMsg}`);
    }

    // 2. Push to ERP (fire-and-forget)
    try {
      await this.erpPush.pushStock(event);
      output.erpPushed = true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Sale] ERP push failed: ${errorMsg}`);
    }

    // 3. Emit webhooks (fire-and-forget)
    try {
      await this.webhookEmitter.emitWebhooks(event);
      output.webhookQueued = true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Sale] Webhook emission failed: ${errorMsg}`);
    }

    // 4. Sync CRM (fire-and-forget)
    try {
      await this.crmSync.syncSale(event);
      output.crmSynced = true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Sale] CRM sync failed: ${errorMsg}`);
    }

    this.logger.log(
      `[Sale] Completed: orderId=${event.orderId}, stock=${output.stockDecrementedCount}, erp=${output.erpPushed}, webhook=${output.webhookQueued}, crm=${output.crmSynced}`
    );

    return output;
  }
}
