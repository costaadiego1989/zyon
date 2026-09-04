import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../integrations/domain/ports/integrations.repository.port.js";
import { WebhookDeliveryDispatcher } from "../../../integrations/application/webhook-delivery-dispatcher.service.js";

/**
 * Emits webhooks to merchant's registered endpoints after sale completes.
 * Event type: inventory.item.decremented
 * Payload: { sku, quantity_decremented, order_id, timestamp }
 * Fire-and-forget: errors logged, not thrown.
 */
@Injectable()
export class InventoryWebhookEmitterService {
  private readonly logger = new Logger(InventoryWebhookEmitterService.name);

  constructor(
    @Optional() @Inject(INTEGRATIONS_REPOSITORY) private readonly integrationsRepo?: IntegrationsRepository,
    @Optional() private readonly webhookDispatcher?: WebhookDeliveryDispatcher
  ) {}

  async emitWebhooks(event: SaleCompletedEvent): Promise<void> {
    if (!this.integrationsRepo || !this.webhookDispatcher) {
      this.logger.debug(`[Webhook] No integrations repo or dispatcher available; skipping`);
      return;
    }

    try {
      // Phase 2: fetch merchant's webhook endpoints filtered by event_type=inventory.item.decremented
      // For now, emit to all active endpoints
      const endpoints = await this.integrationsRepo.listWebhookEndpoints(event.merchantId);
      if (!endpoints || endpoints.length === 0) {
        this.logger.debug(`[Webhook] No webhook endpoints for merchantId=${event.merchantId}`);
        return;
      }

      for (const item of event.items) {
        const payload = {
          sku: item.sku,
          quantity_decremented: item.quantity,
          order_id: event.orderId,
          timestamp: event.timestamp
        };

        for (const endpoint of endpoints) {
          try {
            const envelope = {
              event_type: "inventory.item.decremented",
              merchant_id: event.merchantId,
              payload,
              timestamp: new Date().toISOString(),
              event_id: `evt_${crypto.randomUUID()}`
            };

            const delivery = {
              merchantId: event.merchantId,
              endpointId: endpoint.id,
              endpointUrl: endpoint.url,
              eventType: "inventory.item.decremented",
              eventId: envelope.event_id,
              envelope,
              status: "pending" as const,
              attempts: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              nextAttemptAt: new Date().toISOString()
            };

            // Dispatch async: fire-and-forget
            this.webhookDispatcher.dispatchDelivery(delivery as any).catch((err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              this.logger.warn(`Failed to dispatch inventory webhook: ${errorMsg}`);
            });

            this.logger.debug(
              `[Webhook] Queued: merchantId=${event.merchantId}, endpoint=${endpoint.url}, sku=${item.sku}`
            );
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Failed to queue inventory webhook: ${errorMsg}`);
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Webhook] Failed to emit webhooks: ${errorMsg}`);
      // Do NOT throw: webhook emission failure should not block the sale event
    }
  }
}
