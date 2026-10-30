import { createHash } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

const id = z.string().min(1).max(191);
const scope = z.object({ eventId: id, merchantId: id, eventType: z.literal("shipment.created"),
  schemaVersion: z.literal(1), correlationId: id.optional() });
const payload = z.object({ shipment_id: id, order_id: id, merchant_id: id, carrier_key: id });

/** Records creation of a fulfillment record, not physical dispatch. Order/stock
 * completion already has its own consumers; this audit grants no shipment action. */
@Injectable()
export class ShipmentCreatedAuditHandler implements OnModuleInit {
  private registered = false;
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  onModuleInit(): void {
    if (this.registered) return;
    this.bus.subscribe("shipment.created", event => this.handle(event), "fulfillment.shipment-created.audit.v1");
    this.registered = true;
  }
  async handle(event: DomainEvent): Promise<void> {
    const envelope = scope.parse(event), data = payload.parse(event.payload);
    if (data.merchant_id !== envelope.merchantId) throw Error("shipment_audit_tenant_mismatch");
    const auditId = "shipment-audit:" + createHash("sha256").update(`${envelope.merchantId}\0${envelope.eventId}`).digest("hex");
    await this.prisma.merchantAuditEvent.upsert({ where: { id: auditId }, update: {}, create: {
      id: auditId, merchantId: envelope.merchantId, actorType: "system", actorId: "fulfillment",
      action: envelope.eventType, resourceType: "shipment", resourceId: data.shipment_id,
      correlationId: envelope.correlationId ?? envelope.eventId,
      metadata: { sourceEventId: envelope.eventId, schemaVersion: envelope.schemaVersion,
        shipmentId: data.shipment_id, orderId: data.order_id, carrierKey: data.carrier_key },
    } });
  }
}
