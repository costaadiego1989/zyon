import type { PrismaClient } from "@prisma/client";
import type { IntegrationsRepository } from "../domain/ports/integrations.repository.port.js";
import type {
  MerchantApiKey,
  MerchantApiKeyScope,
  MerchantWebhookDelivery,
  MerchantWebhookEndpoint,
  ShipmentRecord,
  ShipmentStatus,
  TenantWebhookEnvelope,
  TenantWebhookEventType,
  TrackingEventRecord,
  WebhookDeliveryStatus
} from "../domain/integrations.types.js";

export class PrismaIntegrationsRepository implements IntegrationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createApiKey(apiKey: MerchantApiKey): Promise<MerchantApiKey> {
    const row = await (this.prisma as any).merchantApiKey.create({ data: toApiKeyCreate(apiKey) });
    return toApiKey(row);
  }

  async listApiKeys(merchantId: string): Promise<MerchantApiKey[]> {
    const rows = await (this.prisma as any).merchantApiKey.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(toApiKey);
  }

  async getApiKey(merchantId: string, apiKeyId: string): Promise<MerchantApiKey | undefined> {
    const row = await (this.prisma as any).merchantApiKey.findFirst({
      where: { id: apiKeyId, merchantId },
    });
    return row ? toApiKey(row) : undefined;
  }

  async findActiveApiKeyByHash(
    keyHash: string,
    now = new Date().toISOString(),
  ): Promise<MerchantApiKey | undefined> {
    const row = await (this.prisma as any).merchantApiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }],
      }
    });
    return row ? toApiKey(row) : undefined;
  }

  async touchApiKeyLastUsed(apiKeyId: string, at: string): Promise<void> {
    await (this.prisma as any).merchantApiKey.update({
      where: { id: apiKeyId },
      data: { lastUsedAt: new Date(at) }
    });
  }

  async setApiKeyExpiry(
    merchantId: string,
    apiKeyId: string,
    expiresAt: string,
  ): Promise<MerchantApiKey | undefined> {
    try {
      const row = await (this.prisma as any).merchantApiKey.update({
        where: { id: apiKeyId, merchantId },
        data: { expiresAt: new Date(expiresAt) },
      });
      return toApiKey(row);
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async revokeApiKey(merchantId: string, apiKeyId: string, at: string): Promise<MerchantApiKey | undefined> {
    try {
      const row = await (this.prisma as any).merchantApiKey.update({
        where: { id: apiKeyId, merchantId },
        data: { revokedAt: new Date(at) }
      });
      return toApiKey(row);
    } catch (error) {
      if (isPrismaRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async upsertWebhookEndpoint(endpoint: MerchantWebhookEndpoint): Promise<MerchantWebhookEndpoint> {
    const row = await (this.prisma as any).merchantWebhookEndpoint.upsert({
      where: { id: endpoint.id },
      create: toEndpointCreate(endpoint),
      update: toEndpointUpdate(endpoint)
    });
    return toEndpoint(row);
  }

  async listWebhookEndpoints(merchantId: string): Promise<MerchantWebhookEndpoint[]> {
    const rows = await (this.prisma as any).merchantWebhookEndpoint.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(toEndpoint);
  }

  async getWebhookEndpoint(merchantId: string, endpointId: string): Promise<MerchantWebhookEndpoint | undefined> {
    const row = await (this.prisma as any).merchantWebhookEndpoint.findFirst({
      where: { id: endpointId, merchantId }
    });
    return row ? toEndpoint(row) : undefined;
  }

  async saveWebhookDelivery(delivery: MerchantWebhookDelivery): Promise<MerchantWebhookDelivery> {
    const row = await (this.prisma as any).merchantWebhookDelivery.upsert({
      where: { endpointId_eventId: { endpointId: delivery.endpointId, eventId: delivery.eventId } },
      create: toDeliveryCreate(delivery),
      update: {}
    });
    return toDelivery(row);
  }

  async updateWebhookDelivery(delivery: MerchantWebhookDelivery): Promise<MerchantWebhookDelivery> {
    const row = await (this.prisma as any).merchantWebhookDelivery.update({
      where: { id: delivery.id },
      data: toDeliveryUpdate(delivery)
    });
    return toDelivery(row);
  }

  async getWebhookDelivery(merchantId: string, deliveryId: string): Promise<MerchantWebhookDelivery | undefined> {
    const row = await (this.prisma as any).merchantWebhookDelivery.findFirst({
      where: { id: deliveryId, merchantId }
    });
    return row ? toDelivery(row) : undefined;
  }

  async listWebhookDeliveries(merchantId: string, limit = 50): Promise<MerchantWebhookDelivery[]> {
    const rows = await (this.prisma as any).merchantWebhookDelivery.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return rows.map(toDelivery);
  }

  async listDueWebhookDeliveries(statuses: WebhookDeliveryStatus[], now: string, limit = 25): Promise<MerchantWebhookDelivery[]> {
    const rows = await (this.prisma as any).merchantWebhookDelivery.findMany({
      where: {
        status: { in: statuses },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date(now) } }]
      },
      orderBy: { createdAt: "asc" },
      take: limit
    });
    return rows.map(toDelivery);
  }

  async upsertShipment(shipment: ShipmentRecord): Promise<ShipmentRecord> {
    const row = await (this.prisma as any).shipment.upsert({
      where: { merchantId_externalOrderId: { merchantId: shipment.merchantId, externalOrderId: shipment.externalOrderId } },
      create: toShipmentCreate(shipment),
      update: toShipmentUpdate(shipment)
    });
    return toShipment(row);
  }

  async getShipmentByExternalOrderId(merchantId: string, externalOrderId: string): Promise<ShipmentRecord | undefined> {
    const row = await (this.prisma as any).shipment.findUnique({
      where: { merchantId_externalOrderId: { merchantId, externalOrderId } }
    });
    return row ? toShipment(row) : undefined;
  }

  async getShipmentByTrackingCode(merchantId: string, trackingCode: string): Promise<ShipmentRecord | undefined> {
    const row = await (this.prisma as any).shipment.findFirst({
      where: { merchantId, trackingCode }
    });
    return row ? toShipment(row) : undefined;
  }

  async listShipments(merchantId: string, limit = 50): Promise<ShipmentRecord[]> {
    const rows = await (this.prisma as any).shipment.findMany({
      where: { merchantId },
      orderBy: { updatedAt: "desc" },
      take: limit
    });
    return rows.map(toShipment);
  }

  async appendTrackingEvent(event: TrackingEventRecord): Promise<TrackingEventRecord> {
    const row = await (this.prisma as any).trackingEvent.create({ data: toTrackingEventCreate(event) });
    return toTrackingEvent(row);
  }

  async listTrackingEvents(merchantId: string, trackingCode: string): Promise<TrackingEventRecord[]> {
    const rows = await (this.prisma as any).trackingEvent.findMany({
      where: { merchantId, trackingCode },
      orderBy: { occurredAt: "asc" }
    });
    return rows.map(toTrackingEvent);
  }
}

function toApiKeyCreate(apiKey: MerchantApiKey) {
  return {
    id: apiKey.id,
    merchantId: apiKey.merchantId,
    name: apiKey.name,
    keyHash: apiKey.keyHash,
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    environment: apiKey.environment,
    allowedCidrs: apiKey.allowedCidrs,
    createdAt: new Date(apiKey.createdAt),
    expiresAt: apiKey.expiresAt ? new Date(apiKey.expiresAt) : undefined,
    rotatedFromId: apiKey.rotatedFromId,
    lastUsedAt: apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt) : undefined,
    revokedAt: apiKey.revokedAt ? new Date(apiKey.revokedAt) : undefined
  };
}

function toApiKey(row: any): MerchantApiKey {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    keyHash: row.keyHash,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes as MerchantApiKeyScope[],
    environment: row.environment,
    allowedCidrs: row.allowedCidrs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString(),
    rotatedFromId: row.rotatedFromId ?? undefined,
    lastUsedAt: row.lastUsedAt?.toISOString(),
    revokedAt: row.revokedAt?.toISOString()
  };
}

function toEndpointCreate(endpoint: MerchantWebhookEndpoint) {
  return {
    id: endpoint.id,
    merchantId: endpoint.merchantId,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: endpoint.events,
    signingSecret: endpoint.signingSecret,
    description: endpoint.description,
    createdAt: new Date(endpoint.createdAt),
    updatedAt: new Date(endpoint.updatedAt)
  };
}

function toEndpointUpdate(endpoint: MerchantWebhookEndpoint) {
  return {
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: endpoint.events,
    signingSecret: endpoint.signingSecret,
    description: endpoint.description,
    updatedAt: new Date(endpoint.updatedAt)
  };
}

function toEndpoint(row: any): MerchantWebhookEndpoint {
  return {
    id: row.id,
    merchantId: row.merchantId,
    url: row.url,
    enabled: row.enabled,
    events: row.events as TenantWebhookEventType[],
    signingSecret: row.signingSecret,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toDeliveryCreate(delivery: MerchantWebhookDelivery) {
  return {
    id: delivery.id,
    merchantId: delivery.merchantId,
    endpointId: delivery.endpointId,
    endpointUrl: delivery.endpointUrl,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    envelope: delivery.envelope as any,
    signingSecret: delivery.signingSecret,
    nextAttemptAt: delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt) : undefined,
    responseStatus: delivery.responseStatus,
    responseBody: delivery.responseBody,
    error: delivery.error,
    createdAt: new Date(delivery.createdAt),
    updatedAt: new Date(delivery.updatedAt),
    deliveredAt: delivery.deliveredAt ? new Date(delivery.deliveredAt) : undefined
  };
}

function toDeliveryUpdate(delivery: MerchantWebhookDelivery) {
  return {
    status: delivery.status,
    attempts: delivery.attempts,
    envelope: delivery.envelope as any,
    signingSecret: delivery.signingSecret,
    nextAttemptAt: delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt) : null,
    responseStatus: delivery.responseStatus ?? null,
    responseBody: delivery.responseBody ?? null,
    error: delivery.error ?? null,
    updatedAt: new Date(delivery.updatedAt),
    deliveredAt: delivery.deliveredAt ? new Date(delivery.deliveredAt) : null
  };
}

function toDelivery(row: any): MerchantWebhookDelivery {
  return {
    id: row.id,
    merchantId: row.merchantId,
    endpointId: row.endpointId,
    endpointUrl: row.endpointUrl,
    eventId: row.eventId,
    eventType: row.eventType as TenantWebhookEventType,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    envelope: row.envelope as TenantWebhookEnvelope,
    signingSecret: row.signingSecret,
    nextAttemptAt: row.nextAttemptAt?.toISOString(),
    responseStatus: row.responseStatus ?? undefined,
    responseBody: row.responseBody ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString()
  };
}

function toShipmentCreate(shipment: ShipmentRecord) {
  return {
    id: shipment.id,
    merchantId: shipment.merchantId,
    sessionId: shipment.sessionId,
    externalOrderId: shipment.externalOrderId,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
    trackingUrl: shipment.trackingUrl,
    status: shipment.status,
    createdAt: new Date(shipment.createdAt),
    updatedAt: new Date(shipment.updatedAt),
    estimatedEta: shipment.estimatedEta ? new Date(shipment.estimatedEta) : undefined,
    deliveredAt: shipment.deliveredAt ? new Date(shipment.deliveredAt) : undefined
  };
}

function toShipmentUpdate(shipment: ShipmentRecord) {
  return {
    sessionId: shipment.sessionId,
    carrier: shipment.carrier,
    trackingCode: shipment.trackingCode,
    trackingUrl: shipment.trackingUrl,
    status: shipment.status,
    updatedAt: new Date(shipment.updatedAt),
    estimatedEta: shipment.estimatedEta ? new Date(shipment.estimatedEta) : null,
    deliveredAt: shipment.deliveredAt ? new Date(shipment.deliveredAt) : null
  };
}

function toShipment(row: any): ShipmentRecord {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    externalOrderId: row.externalOrderId,
    carrier: row.carrier,
    trackingCode: row.trackingCode,
    trackingUrl: row.trackingUrl ?? undefined,
    status: row.status as ShipmentStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    estimatedEta: row.estimatedEta?.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString()
  };
}

function toTrackingEventCreate(event: TrackingEventRecord) {
  return {
    id: event.id,
    merchantId: event.merchantId,
    shipmentId: event.shipmentId,
    trackingCode: event.trackingCode,
    status: event.status,
    description: event.description,
    location: event.location,
    carrierRaw: event.carrierRaw,
    occurredAt: new Date(event.occurredAt),
    createdAt: new Date(event.createdAt)
  };
}

function toTrackingEvent(row: any): TrackingEventRecord {
  return {
    id: row.id,
    merchantId: row.merchantId,
    shipmentId: row.shipmentId,
    trackingCode: row.trackingCode,
    status: row.status as ShipmentStatus,
    description: row.description,
    location: row.location ?? undefined,
    carrierRaw: row.carrierRaw as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

function isPrismaRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2025"
  );
}
