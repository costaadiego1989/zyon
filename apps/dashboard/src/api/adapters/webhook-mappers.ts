/**
 * Webhook response mappers — convert snake_case API responses to camelCase types.
 */
import type { WebhookEndpoint, WebhookDelivery } from "../types.js";

export type WebhookEndpointApi = {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  description: string | null;
  signing_secret?: string;
  signing_secret_hint: string;
  created_at: string;
  updated_at: string;
};

export type WebhookDeliveryApi = {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_id: string;
  event_type: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
};

export function mapWebhookEndpoint(value: WebhookEndpointApi): WebhookEndpoint {
  return {
    id: value.id,
    url: value.url,
    enabled: value.enabled,
    events: value.events,
    description: value.description ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    signingSecret: value.signing_secret,
    signingSecretHint: value.signing_secret_hint,
  };
}

export function mapWebhookDelivery(value: WebhookDeliveryApi): WebhookDelivery {
  return {
    id: value.id,
    endpointId: value.endpoint_id,
    endpointUrl: value.endpoint_url,
    eventId: value.event_id,
    eventType: value.event_type,
    status: value.status,
    attempts: value.attempts,
    nextAttemptAt: value.next_attempt_at ?? undefined,
    responseStatus: value.response_status ?? undefined,
    responseBody: value.response_body ?? undefined,
    error: value.error ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    deliveredAt: value.delivered_at ?? undefined,
  };
}
