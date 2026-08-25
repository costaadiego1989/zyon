import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";

// Placeholder for ERP adapter port (will be defined in integrations module later)
export const ERP_STOCK_PUSH_PORT = Symbol("ERP_STOCK_PUSH_PORT");

export interface ErpStockPushPort {
  pushStockLevel(
    merchantId: string,
    sku: string,
    quantity: number,
    location?: string
  ): Promise<void>;
}

/**
 * Pushes decremented stock to ERP systems (Bling, Tiny, Omie, etc.)
 * when merchant has an active ErpConnection with direction mirror or aacp_source_of_truth.
 * Fire-and-forget: errors logged, not thrown.
 */
@Injectable()
export class ErpStockPushService {
  private readonly logger = new Logger(ErpStockPushService.name);

  constructor(
    @Optional()
    @Inject(ERP_STOCK_PUSH_PORT)
    private readonly erpAdapter?: ErpStockPushPort
  ) {}

  async pushStock(event: SaleCompletedEvent): Promise<void> {
    if (!this.erpAdapter) {
      this.logger.debug(`[ERP] No ERP adapter available; skipping push`);
      return;
    }

    for (const item of event.items) {
      try {
        // Phase 2: fetch merchant's ErpConnection to check if direction allows push
        // For now, always attempt push if adapter exists
        await this.erpAdapter.pushStockLevel(
          event.merchantId,
          item.sku,
          0 - item.quantity, // Decrement
          undefined // use default location
        );

        this.logger.debug(
          `[ERP] Stock pushed: merchantId=${event.merchantId}, sku=${item.sku}, delta=-${item.quantity}`
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[ERP] Failed to push stock for sale: ${errorMsg}`,
          {
            merchantId: event.merchantId,
            orderId: event.orderId,
            sku: item.sku,
            error: err instanceof Error ? err.stack : undefined
          }
        );
        // Do NOT throw: ERP push failure should not block the sale event
      }
    }
  }
}
