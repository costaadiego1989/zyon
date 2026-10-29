import type { MerchantWebhookDelivery } from "../../../integrations/domain/integrations.types.js";
import { Injectable, Inject } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AppliedInventorySale } from "../../domain/events/sale-completed.event.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../integrations/domain/ports/integrations.repository.port.js";

@Injectable()
export class InventoryWebhookEmitterService {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly integrations: IntegrationsRepository) {}
  async emitWebhooks(sale: AppliedInventorySale): Promise<void> {
    const eventType = "inventory.item.decremented" as const;
    const endpoints = (await this.integrations.listWebhookEndpoints(sale.event.merchantId))
      .filter(endpoint => endpoint.merchantId === sale.event.merchantId && endpoint.enabled && endpoint.events.includes(eventType));
    for (const item of sale.items) {
      const eventId = `inv_evt_${createHash("sha256").update(JSON.stringify([sale.receiptId, item.itemId])).digest("hex")}`;
      for (const endpoint of endpoints) {
        const now = new Date().toISOString();
        const delivery: MerchantWebhookDelivery = { id: `inv_delivery_${createHash("sha256").update(JSON.stringify([endpoint.id, eventId])).digest("hex")}`,
          merchantId: sale.event.merchantId, endpointId: endpoint.id, endpointUrl: endpoint.url, eventId, eventType,
          envelope: { event_id: eventId, event_type: eventType, merchant_id: sale.event.merchantId, occurred_at: sale.event.timestamp,
            api_version: "2026-05-21", data: { sku: item.sku, location_id: item.locationId, quantity_decremented: item.quantity,
              remaining_quantity: item.remainingQuantity, order_id: sale.event.orderId } },
          status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now };
        try { await this.integrations.saveWebhookDelivery(delivery); }
        catch (error) {
          if ((error as { code?: string }).code !== "P2002") throw error;
          // Prisma may emulate upsert; its losing concurrent insert can hit either
          // unique key. Only an identical committed delivery is a successful replay.
          const existing = await this.integrations.getWebhookDelivery(sale.event.merchantId, delivery.id);
          if (!existing || existing.eventId !== eventId || existing.endpointId !== endpoint.id) throw error;
        }
      }
    }
  }
}
