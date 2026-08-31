import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  type MerchantWebhookDelivery,
  type TenantWebhookEnvelope,
  type TenantWebhookEventType,
} from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";

@Injectable()
export class TenantWebhookPublisher {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async publish(input: {
    merchantId: string;
    eventType: TenantWebhookEventType;
    data: Record<string, unknown>;
    occurredAt?: string;
  }): Promise<MerchantWebhookDelivery[]> {
    const endpoints = (await this.repo.listWebhookEndpoints(input.merchantId)).filter(
      (endpoint) => endpoint.enabled && endpoint.events.includes(input.eventType)
    );
    const now = new Date().toISOString();
    const envelope: TenantWebhookEnvelope = {
      event_id: `evt_${randomUUID()}`,
      event_type: input.eventType,
      merchant_id: input.merchantId,
      occurred_at: input.occurredAt ?? now,
      api_version: "2026-05-21",
      data: input.data
    };
    const deliveries: MerchantWebhookDelivery[] = [];
    for (const endpoint of endpoints) {
      deliveries.push(
        await this.repo.saveWebhookDelivery({
          id: `whd_${randomUUID()}`,
          merchantId: input.merchantId,
          endpointId: endpoint.id,
          endpointUrl: endpoint.url,
          eventId: envelope.event_id,
          eventType: input.eventType,
          status: "pending",
          attempts: 0,
          envelope,
          // INT-H3: signing secret no longer persisted in delivery records.
          // The dispatcher looks up the endpoint's current secret at dispatch time.
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now
        })
      );
    }
    return deliveries;
  }
}
