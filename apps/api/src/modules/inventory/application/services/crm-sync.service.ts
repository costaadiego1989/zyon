import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { CRM_PROVIDER_PORT, type CrmProviderPort } from "../../domain/ports/crm-provider.port.js";

/**
 * Syncs sale data to CRM: upserts buyer contact and creates deal.
 * Fire-and-forget: errors logged, not thrown.
 * Phase 2: implement real CRM adapters (HubSpot, Pipedrive).
 */
@Injectable()
export class CrmSyncService {
  private readonly logger = new Logger(CrmSyncService.name);

  constructor(
    @Optional() @Inject(CRM_PROVIDER_PORT) private readonly crm?: CrmProviderPort
  ) {}

  async syncSale(event: SaleCompletedEvent): Promise<void> {
    if (!this.crm) {
      this.logger.debug(`[CRM] No CRM provider available; skipping`);
      return;
    }

    if (!event.buyerEmail) {
      this.logger.debug(`[CRM] No buyer email; skipping CRM sync for orderId=${event.orderId}`);
      return;
    }

    try {
      // Upsert contact
      await this.crm.upsertContact(event.merchantId, {
        email: event.buyerEmail,
        name: event.buyerName,
        phone: event.buyerPhone,
        tags: ["checkout_buyer"]
      });

      this.logger.debug(
        `[CRM] Contact upserted: merchantId=${event.merchantId}, email=${event.buyerEmail}`
      );

      // Create deal
      await this.crm.createDeal(event.merchantId, {
        contactEmail: event.buyerEmail,
        title: `Order ${event.orderId}`,
        valueCents: event.totalCents,
        stage: "won",
        metadata: {
          order_id: event.orderId,
          items_count: event.items.length,
          timestamp: event.timestamp
        }
      });

      this.logger.debug(
        `[CRM] Deal created: merchantId=${event.merchantId}, orderId=${event.orderId}, value=${event.totalCents / 100} BRL`
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[CRM] Failed to sync sale: ${errorMsg}`, {
        merchantId: event.merchantId,
        orderId: event.orderId,
        email: event.buyerEmail,
        error: err instanceof Error ? err.stack : undefined
      });
      // Do NOT throw: CRM sync failure should not block the sale event
    }
  }
}
