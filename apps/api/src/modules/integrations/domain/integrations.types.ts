export type MerchantApiKeyScope =
  | "embed:sessions:create"
  | "orders:tracking:write"
  | "webhooks:read"
  | "webhooks:write";

export const DEFAULT_MERCHANT_API_KEY_SCOPES: MerchantApiKeyScope[] = [
  "embed:sessions:create",
  "orders:tracking:write"
];

export interface MerchantApiKey {
  id: string;
  merchantId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: MerchantApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface MerchantApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: MerchantApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface MerchantApiKeyContext {
  id: string;
  merchantId: string;
  scopes: MerchantApiKeyScope[];
}

export type TenantWebhookEventType =
  | "order.approved"
  | "customer.upserted"
  | "order.tracking.updated"
  | "payment.failed"
  | "support.ticket.created"
  | "checkout.abandoned";

export const TENANT_WEBHOOK_EVENTS: TenantWebhookEventType[] = [
  "order.approved",
  "customer.upserted",
  "order.tracking.updated",
  "payment.failed",
  "support.ticket.created",
  "checkout.abandoned"
];

export interface MerchantWebhookEndpoint {
  id: string;
  merchantId: string;
  url: string;
  enabled: boolean;
  events: TenantWebhookEventType[];
  signingSecret: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export interface TenantWebhookEnvelope<TData = Record<string, unknown>> {
  event_id: string;
  event_type: TenantWebhookEventType;
  merchant_id: string;
  occurred_at: string;
  api_version: "2026-05-21";
  data: TData;
}

export interface MerchantWebhookDelivery {
  id: string;
  merchantId: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  eventType: TenantWebhookEventType;
  status: WebhookDeliveryStatus;
  attempts: number;
  envelope: TenantWebhookEnvelope;
  signingSecret: string;
  nextAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface MerchantWebhookDeliveryPublic {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  eventType: TenantWebhookEventType;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export type ShipmentStatus =
  | "pending"
  | "label_generated"
  | "dispatched"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "cancelled";

export interface ShipmentRecord {
  id: string;
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  carrier: string;
  trackingCode: string;
  trackingUrl?: string;
  status: ShipmentStatus;
  createdAt: string;
  updatedAt: string;
  estimatedEta?: string;
  deliveredAt?: string;
}

export interface TrackingEventRecord {
  id: string;
  merchantId: string;
  shipmentId: string;
  trackingCode: string;
  status: ShipmentStatus;
  description: string;
  location?: string;
  carrierRaw: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}
