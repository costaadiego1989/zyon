import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import {
  TENANT_API_SCOPES,
  type TenantApiScope,
} from "../../../shared/auth/tenant-principal.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../checkout/domain/ports/order.repository.port.js";
import { UpdateOrderTrackingUseCase } from "../../checkout/application/use-cases/update-order-tracking.use-case.js";
import { ApiKeyService } from "../domain/api-key.service.js";
import { ApiKeyAccessPolicy } from "../domain/api-key-access-policy.js";
import { hasApiKeyScope } from "../domain/api-key-scope.js";
import {
  DEFAULT_MERCHANT_API_KEY_SCOPES,
  TENANT_WEBHOOK_EVENTS,
  type MerchantApiKey,
  type MerchantApiKeyContext,
  type MerchantApiKeyEnvironment,
  type MerchantApiKeyPublic,
  type MerchantApiKeyScope,
  type MerchantWebhookDelivery,
  type MerchantWebhookDeliveryPublic,
  type MerchantWebhookEndpoint,
  type ShipmentStatus,
  type TenantWebhookEnvelope,
  type TenantWebhookEventType,
  type TrackingEventRecord
} from "../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../domain/ports/integrations.repository.port.js";
import {
  WEBHOOK_TARGET_POLICY,
  type WebhookTargetPolicy,
} from "../domain/ports/webhook-target-policy.port.js";

const ALLOWED_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "pending",
  "label_generated",
  "dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled"
];

@Injectable()
export class CreateMerchantApiKeyUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly apiKeys: ApiKeyService,
    private readonly accessPolicy: ApiKeyAccessPolicy,
  ) {}

  async execute(input: {
    merchantId: string;
    name?: string;
    scopes?: MerchantApiKeyScope[];
    environment?: MerchantApiKeyEnvironment;
    expiresAt?: string;
    allowedCidrs?: string[];
    rotatedFromId?: string;
  }) {
    const environment = input.environment ?? "test";
    const generated = this.apiKeys.generate(environment);
    const now = new Date().toISOString();
    const scopes = sanitizeScopes(input.scopes ?? DEFAULT_MERCHANT_API_KEY_SCOPES);
    const apiKey = await this.repo.createApiKey({
      id: `mak_${randomUUID()}`,
      merchantId: input.merchantId,
      name: sanitizeName(input.name, "Backend integration"),
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      scopes,
      environment,
      allowedCidrs: this.accessPolicy.normalizeCidrs(input.allowedCidrs),
      createdAt: now,
      expiresAt: parseFutureExpiry(input.expiresAt, now),
      rotatedFromId: input.rotatedFromId,
    });

    return {
      api_key: toApiKeyPublic(apiKey),
      secret_key: generated.rawKey
    };
  }
}

@Injectable()
export class ListMerchantApiKeysUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string): Promise<MerchantApiKeyPublic[]> {
    return (await this.repo.listApiKeys(merchantId)).map(toApiKeyPublic);
  }
}

@Injectable()
export class RevokeMerchantApiKeyUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, apiKeyId: string): Promise<MerchantApiKeyPublic> {
    const revoked = await this.repo.revokeApiKey(merchantId, apiKeyId, new Date().toISOString());
    if (!revoked) throw new NotFoundException("merchant_api_key_not_found");
    return toApiKeyPublic(revoked);
  }
}

@Injectable()
export class RotateMerchantApiKeyUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly createApiKey: CreateMerchantApiKeyUseCase,
  ) {}

  async execute(input: {
    merchantId: string;
    apiKeyId: string;
    overlapSeconds?: number;
  }) {
    const existing = await this.repo.getApiKey(input.merchantId, input.apiKeyId);
    if (!existing || existing.revokedAt) {
      throw new NotFoundException("merchant_api_key_not_found");
    }

    const now = new Date().toISOString();
    if (existing.expiresAt && existing.expiresAt <= now) {
      throw new NotFoundException("merchant_api_key_not_found");
    }
    const overlapSeconds = Math.max(
      0,
      Math.min(input.overlapSeconds ?? 300, 86_400),
    );
    const requestedOverlapEnd = new Date(
      Date.now() + overlapSeconds * 1000,
    ).toISOString();
    const oldKeyExpiresAt = existing.expiresAt
      && existing.expiresAt < requestedOverlapEnd
      ? existing.expiresAt
      : requestedOverlapEnd;

    const rotated = await this.createApiKey.execute({
      merchantId: input.merchantId,
      name: `${existing.name} (rotated)`,
      scopes: existing.scopes.map((scope) =>
        scope === "orders:tracking:write" ? "tracking:write" : scope),
      environment: existing.environment,
      expiresAt: existing.expiresAt,
      allowedCidrs: existing.allowedCidrs,
      rotatedFromId: existing.id,
    });
    const updatedPrevious = await this.repo.setApiKeyExpiry(
      input.merchantId,
      input.apiKeyId,
      oldKeyExpiresAt,
    );
    if (!updatedPrevious) {
      await this.repo.revokeApiKey(
        input.merchantId,
        rotated.api_key.id,
        new Date().toISOString(),
      );
      throw new NotFoundException("merchant_api_key_not_found");
    }

    return {
      ...rotated,
      previous_api_key_id: existing.id,
      previous_key_expires_at: oldKeyExpiresAt,
    };
  }
}

@Injectable()
export class UpsertWebhookEndpointUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
    @Optional()
    @Inject(WEBHOOK_TARGET_POLICY)
    private readonly targetPolicy?: WebhookTargetPolicy,
  ) {}

  async execute(input: {
    merchantId: string;
    endpointId?: string;
    url: string;
    events?: TenantWebhookEventType[];
    enabled?: boolean;
    description?: string;
  }) {
    const now = new Date().toISOString();
    const existing = input.endpointId ? await this.repo.getWebhookEndpoint(input.merchantId, input.endpointId) : undefined;
    if (input.endpointId && !existing) throw new NotFoundException("webhook_endpoint_not_found");
    const endpointUrl = this.targetPolicy
      ? await this.targetPolicy.assertAllowed(input.url)
      : validateEndpointUrl(input.url);
    const endpoint: MerchantWebhookEndpoint = {
      id: existing?.id ?? `wh_${randomUUID()}`,
      merchantId: input.merchantId,
      url: endpointUrl,
      enabled: input.enabled ?? existing?.enabled ?? true,
      events: sanitizeWebhookEvents(input.events ?? existing?.events ?? ["order.approved", "customer.upserted", "order.tracking.updated"]),
      signingSecret: existing?.signingSecret ?? `whsec_${randomBytes(24).toString("base64url")}`,
      description: input.description ?? existing?.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    return toEndpointPublic(await this.repo.upsertWebhookEndpoint(endpoint), { includeSecret: !existing });
  }
}

@Injectable()
export class GetWebhookEndpointUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
  ) {}

  async execute(merchantId: string, endpointId: string) {
    const endpoint = await this.repo.getWebhookEndpoint(
      merchantId,
      endpointId,
    );
    if (!endpoint) throw new NotFoundException("webhook_endpoint_not_found");
    return toEndpointPublic(endpoint);
  }
}

@Injectable()
export class RotateWebhookSigningSecretUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
  ) {}

  async execute(merchantId: string, endpointId: string) {
    const endpoint = await this.repo.getWebhookEndpoint(
      merchantId,
      endpointId,
    );
    if (!endpoint) throw new NotFoundException("webhook_endpoint_not_found");
    const rotated = await this.repo.upsertWebhookEndpoint({
      ...endpoint,
      signingSecret: `whsec_${randomBytes(24).toString("base64url")}`,
      updatedAt: new Date().toISOString(),
    });
    return toEndpointPublic(rotated, { includeSecret: true });
  }
}

@Injectable()
export class ListWebhookEndpointsUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string) {
    return (await this.repo.listWebhookEndpoints(merchantId)).map((endpoint) => toEndpointPublic(endpoint));
  }
}

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
          signingSecret: endpoint.signingSecret,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now
        })
      );
    }
    return deliveries;
  }
}

@Injectable()
export class ListWebhookDeliveriesUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, limit?: number): Promise<MerchantWebhookDeliveryPublic[]> {
    return (await this.repo.listWebhookDeliveries(merchantId, limit)).map(toDeliveryPublic);
  }
}

@Injectable()
export class GetWebhookDeliveryUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
  ) {}

  async execute(merchantId: string, deliveryId: string) {
    const delivery = await this.repo.getWebhookDelivery(
      merchantId,
      deliveryId,
    );
    if (!delivery) throw new NotFoundException("webhook_delivery_not_found");
    return toDeliveryPublic(delivery);
  }
}

@Injectable()
export class ReplayWebhookDeliveryUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, deliveryId: string): Promise<MerchantWebhookDeliveryPublic> {
    const delivery = await this.repo.getWebhookDelivery(merchantId, deliveryId);
    if (!delivery) throw new NotFoundException("webhook_delivery_not_found");
    const now = new Date().toISOString();
    return toDeliveryPublic(await this.repo.updateWebhookDelivery({
      ...delivery,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      responseStatus: undefined,
      responseBody: undefined,
      error: undefined,
      deliveredAt: undefined,
      updatedAt: now
    }));
  }
}

@Injectable()
export class TestWebhookEndpointUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly publisher: TenantWebhookPublisher
  ) {}

  async execute(merchantId: string, endpointId: string): Promise<MerchantWebhookDeliveryPublic> {
    const endpoint = await this.repo.getWebhookEndpoint(merchantId, endpointId);
    if (!endpoint) throw new NotFoundException("webhook_endpoint_not_found");
    const deliveries = await this.publisher.publish({
      merchantId,
      eventType: "order.approved",
      data: {
        test: true,
        order: { external_order_id: "test-order", status: "approved" }
      }
    });
    const delivery = deliveries.find((candidate) => candidate.endpointId === endpointId);
    if (!delivery) throw new BadRequestException("webhook_event_not_enabled_for_endpoint");
    return toDeliveryPublic(delivery);
  }
}

@Injectable()
export class UpdateTenantOrderTrackingUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly updateOrderTracking: UpdateOrderTrackingUseCase,
    private readonly publisher: TenantWebhookPublisher
  ) {}

  async execute(input: {
    merchantId: string;
    externalOrderId: string;
    body: {
      session_id?: string;
      tracking_code?: string;
      carrier?: string;
      tracking_url?: string;
      status?: string;
      events?: Array<{
        status?: string;
        description?: string;
        location?: string;
        occurred_at?: string;
        carrier_raw?: Record<string, unknown>;
      }>;
    };
  }) {
    const trackingCode = input.body.tracking_code?.trim();
    if (!trackingCode) throw new BadRequestException("tracking_code_required");
    const merchantId = input.merchantId.trim();
    if (!merchantId) throw new BadRequestException("merchant_id_required");
    const order = input.body.session_id
      ? await this.orders.getCompletedOrder(merchantId, input.body.session_id, input.externalOrderId)
      : await this.orders.findCompletedOrderByExternalOrderId(merchantId, input.externalOrderId);
    if (!order) throw new NotFoundException("completed_order_not_found");

    const update = await this.updateOrderTracking.execute({
      merchant_id: merchantId,
      session_id: order.sessionId,
      external_order_id: order.externalOrderId,
      tracking_code: trackingCode
    });
    const now = new Date().toISOString();
    const shipment = await this.repo.upsertShipment({
      id: `shp_${randomUUID()}`,
      merchantId,
      sessionId: order.sessionId,
      externalOrderId: order.externalOrderId,
      carrier: sanitizeName(input.body.carrier, "manual"),
      trackingCode,
      trackingUrl: input.body.tracking_url,
      status: normalizeShipmentStatus(input.body.status, "label_generated"),
      createdAt: now,
      updatedAt: now
    });

    const events: TrackingEventRecord[] = [];
    for (const event of input.body.events ?? []) {
      events.push(
        await this.repo.appendTrackingEvent({
          id: `trk_evt_${randomUUID()}`,
          merchantId,
          shipmentId: shipment.id,
          trackingCode,
          status: normalizeShipmentStatus(event.status, shipment.status),
          description: sanitizeName(event.description, "Tracking updated"),
          location: event.location?.trim() || undefined,
          carrierRaw: event.carrier_raw ?? {},
          occurredAt: parseIsoDateOrNow(event.occurred_at),
          createdAt: now
        })
      );
    }

    const session = await this.sessions.getSession(merchantId, order.sessionId);
    await this.publisher.publish({
      merchantId,
      eventType: "order.tracking.updated",
      data: {
        order: {
          external_order_id: order.externalOrderId,
          session_id: order.sessionId,
          status: "tracking_updated"
        },
        customer: session?.customer ?? null,
        tracking: {
          tracking_code: trackingCode,
          carrier: shipment.carrier,
          tracking_url: shipment.trackingUrl ?? null,
          status: shipment.status,
          events
        }
      }
    });

    return {
      updated: true,
      changed: update.changed,
      order: update.order,
      shipment,
      events_recorded: events.length
    };
  }
}

@Injectable()
export class ListTenantShipmentsUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, limit?: number) {
    return this.repo.listShipments(merchantId, limit);
  }
}

@Injectable()
export class GetTrackingTimelineUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(input: { merchantId: string; trackingCode: string }) {
    const shipment = await this.repo.getShipmentByTrackingCode(input.merchantId, input.trackingCode);
    if (!shipment) throw new NotFoundException("shipment_not_found");
    return {
      shipment,
      events: await this.repo.listTrackingEvents(input.merchantId, input.trackingCode)
    };
  }
}

export function requireScope(context: MerchantApiKeyContext, scope: TenantApiScope): void {
  if (!hasApiKeyScope(context.scopes, scope)) {
    throw new ForbiddenException("missing_api_key_scope");
  }
}

function toApiKeyPublic(apiKey: MerchantApiKey): MerchantApiKeyPublic {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    environment: apiKey.environment,
    allowedCidrs: apiKey.allowedCidrs,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
    rotatedFromId: apiKey.rotatedFromId,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt
  };
}

function toEndpointPublic(endpoint: MerchantWebhookEndpoint, options?: { includeSecret?: boolean }) {
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

function toDeliveryPublic(delivery: MerchantWebhookDelivery): MerchantWebhookDeliveryPublic {
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

function sanitizeName(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 120);
}

function sanitizeScopes(scopes: MerchantApiKeyScope[]): MerchantApiKeyScope[] {
  const allowed = new Set<MerchantApiKeyScope>(TENANT_API_SCOPES);
  const unique = Array.from(new Set(scopes.filter((scope) => allowed.has(scope))));
  if (!unique.length) throw new BadRequestException("api_key_scopes_required");
  return unique;
}

function parseFutureExpiry(value: string | undefined, now: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() <= now) {
    throw new BadRequestException("api_key_expiry_must_be_in_the_future");
  }
  return parsed.toISOString();
}

function sanitizeWebhookEvents(events: TenantWebhookEventType[]): TenantWebhookEventType[] {
  const allowed = new Set<TenantWebhookEventType>(TENANT_WEBHOOK_EVENTS);
  const unique = Array.from(new Set(events.filter((event) => allowed.has(event))));
  if (!unique.length) throw new BadRequestException("webhook_events_required");
  return unique;
}

function validateEndpointUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.toString();
  } catch {
    throw new BadRequestException("invalid_webhook_url");
  }
  throw new BadRequestException("webhook_url_must_be_https");
}

function normalizeShipmentStatus(value: string | undefined, fallback: ShipmentStatus): ShipmentStatus {
  return ALLOWED_SHIPMENT_STATUSES.includes(value as ShipmentStatus) ? value as ShipmentStatus : fallback;
}

function parseIsoDateOrNow(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
