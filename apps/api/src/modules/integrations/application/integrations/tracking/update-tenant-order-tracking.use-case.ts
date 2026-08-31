import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../../checkout/domain/ports/checkout-session.repository.port.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../../../checkout/domain/ports/order.repository.port.js";
import { CHECKOUT_ORDER_TRACKING_UPDATER, type CheckoutOrderTrackingUpdater } from "../../../../checkout/domain/ports/order-tracking-updater.port.js";
import { type TrackingEventRecord } from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { sanitizeName } from "../shared.js";
import { TenantWebhookPublisher } from "../webhooks/tenant-webhook-publisher.js";
import { normalizeShipmentStatus, parseIsoDateOrNow } from "./tracking.helpers.js";

@Injectable()
export class UpdateTenantOrderTrackingUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(CHECKOUT_ORDER_TRACKING_UPDATER) private readonly updateOrderTracking: CheckoutOrderTrackingUpdater,
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
