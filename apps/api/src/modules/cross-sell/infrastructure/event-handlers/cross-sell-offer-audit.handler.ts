import { createHash } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

const payloadSchema = z.object({ session_id: z.string().min(1), promo_id: z.string().min(1) });

/** Durable offer lifecycle is auditable even when no external subscriber exists. */
@Injectable()
export class CrossSellOfferAuditHandler implements OnModuleInit {
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  onModuleInit() {
    for (const eventType of ["cross-sell.offer.suggested", "cross-sell.offer.accepted", "cross-sell.offer.declined"]) {
      this.bus.subscribe(eventType, event => this.handle(event), `cross-sell:audit:${eventType}`);
    }
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!event.eventId || !event.merchantId) throw new Error("cross_sell_audit_scope_missing");
    const data = payloadSchema.parse(event.payload);
    const id = "cross-sell-audit:" + createHash("sha256").update(`${event.merchantId}\0${event.eventId}`).digest("hex");
    await this.prisma.merchantAuditEvent.upsert({ where: { id }, update: {}, create: {
      id, merchantId: event.merchantId, actorType: "system", actorId: "cross-sell", action: event.eventType,
      resourceType: "cross_sell_offer", resourceId: data.promo_id, correlationId: event.correlationId ?? data.session_id,
      metadata: { sourceEventId: event.eventId, sessionId: data.session_id, promotionId: data.promo_id },
    } });
  }
}
