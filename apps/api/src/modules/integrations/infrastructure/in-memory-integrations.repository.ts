import { Injectable } from "@nestjs/common";
import type { IntegrationsRepository } from "../domain/ports/integrations.repository.port.js";
import type {
  MerchantApiKey,
  MerchantWebhookDelivery,
  MerchantWebhookEndpoint,
  ShipmentRecord,
  TrackingEventRecord,
  WebhookDeliveryStatus
} from "../domain/integrations.types.js";

@Injectable()
export class InMemoryIntegrationsRepository implements IntegrationsRepository {
  private readonly apiKeys = new Map<string, MerchantApiKey>();
  private readonly endpoints = new Map<string, MerchantWebhookEndpoint>();
  private readonly deliveries = new Map<string, MerchantWebhookDelivery>();
  private readonly shipments = new Map<string, ShipmentRecord>();
  private readonly trackingEvents = new Map<string, TrackingEventRecord>();

  async createApiKey(apiKey: MerchantApiKey): Promise<MerchantApiKey> {
    this.apiKeys.set(apiKey.id, clone(apiKey));
    return clone(apiKey);
  }

  async listApiKeys(merchantId: string): Promise<MerchantApiKey[]> {
    return Array.from(this.apiKeys.values())
      .filter((apiKey) => apiKey.merchantId === merchantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async getApiKey(merchantId: string, apiKeyId: string): Promise<MerchantApiKey | undefined> {
    const apiKey = this.apiKeys.get(apiKeyId);
    return apiKey?.merchantId === merchantId ? clone(apiKey) : undefined;
  }

  async findActiveApiKeyByHash(keyHash: string, now = new Date().toISOString()): Promise<MerchantApiKey | undefined> {
    const found = Array.from(this.apiKeys.values()).find(
      (apiKey) =>
        apiKey.keyHash === keyHash
        && !apiKey.revokedAt
        && (!apiKey.expiresAt || apiKey.expiresAt > now),
    );
    return found ? clone(found) : undefined;
  }

  async touchApiKeyLastUsed(apiKeyId: string, at: string): Promise<void> {
    const existing = this.apiKeys.get(apiKeyId);
    if (existing) this.apiKeys.set(apiKeyId, { ...existing, lastUsedAt: at });
  }

  async setApiKeyExpiry(
    merchantId: string,
    apiKeyId: string,
    expiresAt: string,
  ): Promise<MerchantApiKey | undefined> {
    const existing = this.apiKeys.get(apiKeyId);
    if (!existing || existing.merchantId !== merchantId) return undefined;
    const updated = { ...existing, expiresAt };
    this.apiKeys.set(apiKeyId, updated);
    return clone(updated);
  }

  async revokeApiKey(merchantId: string, apiKeyId: string, at: string): Promise<MerchantApiKey | undefined> {
    const existing = this.apiKeys.get(apiKeyId);
    if (!existing || existing.merchantId !== merchantId) return undefined;
    const revoked = { ...existing, revokedAt: existing.revokedAt ?? at };
    this.apiKeys.set(apiKeyId, revoked);
    return clone(revoked);
  }

  async upsertWebhookEndpoint(endpoint: MerchantWebhookEndpoint): Promise<MerchantWebhookEndpoint> {
    this.endpoints.set(endpoint.id, clone(endpoint));
    return clone(endpoint);
  }

  async listWebhookEndpoints(merchantId: string): Promise<MerchantWebhookEndpoint[]> {
    return Array.from(this.endpoints.values())
      .filter((endpoint) => endpoint.merchantId === merchantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  async getWebhookEndpoint(merchantId: string, endpointId: string): Promise<MerchantWebhookEndpoint | undefined> {
    const endpoint = this.endpoints.get(endpointId);
    return endpoint?.merchantId === merchantId ? clone(endpoint) : undefined;
  }

  async saveWebhookDelivery(delivery: MerchantWebhookDelivery): Promise<MerchantWebhookDelivery> {
    const duplicate = Array.from(this.deliveries.values()).find(
      (current) => current.endpointId === delivery.endpointId && current.eventId === delivery.eventId
    );
    const next = duplicate ? { ...delivery, id: duplicate.id, attempts: duplicate.attempts, status: duplicate.status } : delivery;
    this.deliveries.set(next.id, clone(next));
    return clone(next);
  }

  async updateWebhookDelivery(delivery: MerchantWebhookDelivery): Promise<MerchantWebhookDelivery> {
    this.deliveries.set(delivery.id, clone(delivery));
    return clone(delivery);
  }

  async getWebhookDelivery(merchantId: string, deliveryId: string): Promise<MerchantWebhookDelivery | undefined> {
    const delivery = this.deliveries.get(deliveryId);
    return delivery?.merchantId === merchantId ? clone(delivery) : undefined;
  }

  async listWebhookDeliveries(merchantId: string, limit = 50): Promise<MerchantWebhookDelivery[]> {
    return Array.from(this.deliveries.values())
      .filter((delivery) => delivery.merchantId === merchantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async listDueWebhookDeliveries(statuses: WebhookDeliveryStatus[], now: string, limit = 25): Promise<MerchantWebhookDelivery[]> {
    return Array.from(this.deliveries.values())
      .filter((delivery) => statuses.includes(delivery.status))
      .filter((delivery) => !delivery.nextAttemptAt || delivery.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async upsertShipment(shipment: ShipmentRecord): Promise<ShipmentRecord> {
    const existing = Array.from(this.shipments.values()).find(
      (current) => current.merchantId === shipment.merchantId && current.externalOrderId === shipment.externalOrderId
    );
    const next = existing ? { ...existing, ...shipment, id: existing.id, createdAt: existing.createdAt } : shipment;
    this.shipments.set(next.id, clone(next));
    return clone(next);
  }

  async getShipmentByExternalOrderId(merchantId: string, externalOrderId: string): Promise<ShipmentRecord | undefined> {
    const shipment = Array.from(this.shipments.values()).find(
      (current) => current.merchantId === merchantId && current.externalOrderId === externalOrderId
    );
    return shipment ? clone(shipment) : undefined;
  }

  async getShipmentByTrackingCode(merchantId: string, trackingCode: string): Promise<ShipmentRecord | undefined> {
    const shipment = Array.from(this.shipments.values()).find(
      (current) => current.merchantId === merchantId && current.trackingCode === trackingCode
    );
    return shipment ? clone(shipment) : undefined;
  }

  async listShipments(merchantId: string, limit = 50): Promise<ShipmentRecord[]> {
    return Array.from(this.shipments.values())
      .filter((shipment) => shipment.merchantId === merchantId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  async appendTrackingEvent(event: TrackingEventRecord): Promise<TrackingEventRecord> {
    this.trackingEvents.set(event.id, clone(event));
    return clone(event);
  }

  async listTrackingEvents(merchantId: string, trackingCode: string): Promise<TrackingEventRecord[]> {
    return Array.from(this.trackingEvents.values())
      .filter((event) => event.merchantId === merchantId && event.trackingCode === trackingCode)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map(clone);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
