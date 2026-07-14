import type { TenantApiScope } from "../../../shared/auth/tenant-principal.js";

export type MerchantApiKeyEnvironment = "test" | "live";
export type LegacyMerchantApiKeyScope = "orders:tracking:write";
export type MerchantApiKeyScope = TenantApiScope | LegacyMerchantApiKeyScope;

export const DEFAULT_MERCHANT_API_KEY_SCOPES: MerchantApiKeyScope[] = [
  "embed:sessions:create",
  "orders:read",
  "orders:write",
  "tracking:read",
  "tracking:write",
];

export interface MerchantApiKey {
  id: string;
  merchantId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: MerchantApiKeyScope[];
  environment: MerchantApiKeyEnvironment;
  allowedCidrs: string[];
  createdAt: string;
  expiresAt?: string;
  rotatedFromId?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface MerchantApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: MerchantApiKeyScope[];
  environment: MerchantApiKeyEnvironment;
  allowedCidrs: string[];
  createdAt: string;
  expiresAt?: string;
  rotatedFromId?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface MerchantApiKeyContext {
  id: string;
  merchantId: string;
  scopes: MerchantApiKeyScope[];
  environment: MerchantApiKeyEnvironment;
  allowedCidrs: string[];
  expiresAt?: string;
}

export type TenantWebhookEventType =
  | "checkout.started"
  | "checkout.abandoned"
  | "order.created"
  | "order.approved"
  | "order.cancelled"
  | "order.cancellation_provider_failed"
  | "payment.pending"
  | "payment.approved"
  | "customer.upserted"
  | "tracking.updated"
  | "order.tracking.updated"
  | "payment.failed"
  | "payment.refunded"
  | "support.ticket.created"
  | "commerce.connection.degraded";

export const TENANT_WEBHOOK_EVENTS: TenantWebhookEventType[] = [
  "checkout.started",
  "checkout.abandoned",
  "order.created",
  "order.approved",
  "order.cancelled",
  "payment.pending",
  "payment.approved",
  "payment.failed",
  "payment.refunded",
  "customer.upserted",
  "tracking.updated",
  "order.tracking.updated",
  "support.ticket.created",
  "commerce.connection.degraded",
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

export type WebhookDeliveryStatus = "pending" | "sending" | "delivered" | "failed";

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
  /** @deprecated Signing secret is now looked up per-dispatch from the endpoint. */
  signingSecret?: string;
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
