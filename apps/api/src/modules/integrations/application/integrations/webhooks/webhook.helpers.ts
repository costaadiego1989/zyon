import { BadRequestException } from "@nestjs/common";
import {
  TENANT_WEBHOOK_EVENTS,
  type MerchantWebhookDelivery,
  type MerchantWebhookDeliveryPublic,
  type MerchantWebhookEndpoint,
  type TenantWebhookEventType,
} from "../../../domain/integrations.types.js";

export function toEndpointPublic(endpoint: MerchantWebhookEndpoint, options?: { includeSecret?: boolean }) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: endpoint.events,
    description: endpoint.description,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
    signingSecret: options?.includeSecret ? endpoint.signingSecret : undefined,
    signingSecretHint: `${endpoint.signingSecret.slice(0, 9)}...${endpoint.signingSecret.slice(-4)}`
  };
}

export function toDeliveryPublic(delivery: MerchantWebhookDelivery): MerchantWebhookDeliveryPublic {
  return {
    id: delivery.id,
    endpointId: delivery.endpointId,
    endpointUrl: delivery.endpointUrl,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt,
    responseStatus: delivery.responseStatus,
    responseBody: delivery.responseBody,
    error: delivery.error,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
    deliveredAt: delivery.deliveredAt
  };
}

export function sanitizeWebhookEvents(events: TenantWebhookEventType[]): TenantWebhookEventType[] {
  const allowed = new Set<TenantWebhookEventType>(TENANT_WEBHOOK_EVENTS);
  const unique = Array.from(new Set(events.filter((event) => allowed.has(event))));
  if (!unique.length) throw new BadRequestException("webhook_events_required");
  return unique;
}

export function validateEndpointUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.toString();
  } catch {
    throw new BadRequestException("invalid_webhook_url");
  }
  throw new BadRequestException("webhook_url_must_be_https");
}
