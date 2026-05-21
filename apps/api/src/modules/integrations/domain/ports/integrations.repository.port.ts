import type {
  MerchantApiKey,
  MerchantWebhookDelivery,
  MerchantWebhookEndpoint,
  ShipmentRecord,
  TrackingEventRecord,
  WebhookDeliveryStatus
} from "../integrations.types.js";

export const INTEGRATIONS_REPOSITORY = Symbol("INTEGRATIONS_REPOSITORY");

export interface IntegrationsRepository {
  createApiKey(apiKey: MerchantApiKey): Promise<MerchantApiKey>;
  listApiKeys(merchantId: string): Promise<MerchantApiKey[]>;
  findActiveApiKeyByHash(keyHash: string): Promise<MerchantApiKey | undefined>;
  touchApiKeyLastUsed(apiKeyId: string, at: string): Promise<void>;
  revokeApiKey(merchantId: string, apiKeyId: string, at: string): Promise<MerchantApiKey | undefined>;

  upsertWebhookEndpoint(endpoint: MerchantWebhookEndpoint): Promise<MerchantWebhookEndpoint>;
  listWebhookEndpoints(merchantId: string): Promise<MerchantWebhookEndpoint[]>;
  getWebhookEndpoint(merchantId: string, endpointId: string): Promise<MerchantWebhookEndpoint | undefined>;

  saveWebhookDelivery(delivery: MerchantWebhookDelivery): Promise<MerchantWebhookDelivery>;
  updateWebhookDelivery(delivery: MerchantWebhookDelivery): Promise<MerchantWebhookDelivery>;
  getWebhookDelivery(merchantId: string, deliveryId: string): Promise<MerchantWebhookDelivery | undefined>;
  listWebhookDeliveries(merchantId: string, limit?: number): Promise<MerchantWebhookDelivery[]>;
  listDueWebhookDeliveries(statuses: WebhookDeliveryStatus[], now: string, limit?: number): Promise<MerchantWebhookDelivery[]>;

  upsertShipment(shipment: ShipmentRecord): Promise<ShipmentRecord>;
  getShipmentByExternalOrderId(merchantId: string, externalOrderId: string): Promise<ShipmentRecord | undefined>;
  getShipmentByTrackingCode(merchantId: string, trackingCode: string): Promise<ShipmentRecord | undefined>;
  listShipments(merchantId: string, limit?: number): Promise<ShipmentRecord[]>;
  appendTrackingEvent(event: TrackingEventRecord): Promise<TrackingEventRecord>;
  listTrackingEvents(merchantId: string, trackingCode: string): Promise<TrackingEventRecord[]>;
}
