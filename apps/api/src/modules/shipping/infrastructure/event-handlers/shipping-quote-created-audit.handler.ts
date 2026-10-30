import { createHash } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

const id = z.string().min(1).max(191);
const scope = z.object({ eventId: id, merchantId: id, eventType: z.literal("shipping.quote.created"),
  schemaVersion: z.literal(1), correlationId: id.optional() });
const payload = z.object({ quote_id: id, session_id: id, merchant_id: id.optional(),
  option_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), expires_at: z.string().datetime() });

/** The quote is already persisted by the producer. Its event is informational:
 * preserve the operational audit, never select freight, charge or buy a label. */
@Injectable()
export class ShippingQuoteCreatedAuditHandler implements OnModuleInit {
  private registered = false;
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  onModuleInit(): void {
    if (this.registered) return;
    this.bus.subscribe("shipping.quote.created", event => this.handle(event), "shipping.quote-created.audit.v1");
    this.registered = true;
  }
  async handle(event: DomainEvent): Promise<void> {
    const envelope = scope.parse(event), data = payload.parse(event.payload);
    if (data.merchant_id !== undefined && data.merchant_id !== envelope.merchantId) throw Error("shipping_quote_audit_tenant_mismatch");
    const auditId = "shipping-quote-audit:" + createHash("sha256").update(`${envelope.merchantId}\0${envelope.eventId}`).digest("hex");
    await this.prisma.merchantAuditEvent.upsert({ where: { id: auditId }, update: {}, create: {
      id: auditId, merchantId: envelope.merchantId, actorType: "system", actorId: "shipping",
      action: envelope.eventType, resourceType: "shipping_quote", resourceId: data.quote_id,
      correlationId: envelope.correlationId ?? envelope.eventId,
      metadata: { sourceEventId: envelope.eventId, schemaVersion: envelope.schemaVersion,
        quoteId: data.quote_id, sessionId: data.session_id, optionCount: data.option_count, expiresAt: data.expires_at },
    } });
  }
}
