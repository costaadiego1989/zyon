import type { TenantWebhookEventType } from "../../../../integrations/domain/integrations.types.js";
import type { WebhookDeliveryResponse, WebhookResponse } from "../../presentation/http/dtos/webhook.dtos.js";

interface WebhookEndpointEntity {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  signingSecret?: string;
  signingSecretHint: string;
}

interface WebhookDeliveryEntity {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export class WebhookEntityMapper {
  static toResponse(endpoint: WebhookEndpointEntity): WebhookResponse {
    return {
      id: endpoint.id,
      url: endpoint.url,
      active: endpoint.enabled,
      events: endpoint.events as TenantWebhookEventType[],
      description: endpoint.description ?? null,
      secret_key: endpoint.signingSecret,
      secret_key_hint: endpoint.signingSecretHint,
      created_at: endpoint.createdAt,
      updated_at: endpoint.updatedAt,
    };
  }

  static toListResponse(endpoints: WebhookEndpointEntity[]): WebhookResponse[] {
    return endpoints.map((e) => WebhookEntityMapper.toResponse(e));
  }

  static toDeliveryResponse(delivery: WebhookDeliveryEntity): WebhookDeliveryResponse {
    return {
      id: delivery.id,
      webhook_id: delivery.endpointId,
      webhook_url: delivery.endpointUrl,
      event_id: delivery.eventId,
      event_type: delivery.eventType as TenantWebhookEventType,
      status: delivery.status,
      attempts: delivery.attempts,
      next_attempt_at: delivery.nextAttemptAt ?? null,
      response_status: delivery.responseStatus ?? null,
      response_body: delivery.responseBody ?? null,
      error: delivery.error ?? null,
      created_at: delivery.createdAt,
      updated_at: delivery.updatedAt,
      delivered_at: delivery.deliveredAt ?? null,
    };
  }
}
