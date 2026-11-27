import { isDeepStrictEqual } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type { DomainEventBus, DomainEvent } from "../../../shared/events/domain-event-bus.port.js";
import type { FiscalCancellationService } from "../application/fiscal-cancellation.service.js";
export class OnOrderFiscalReviewHandler {
  constructor(private readonly prisma: PrismaClient, private readonly bus: DomainEventBus, private readonly cancellation: FiscalCancellationService) {}
  onModuleInit() { this.bus.subscribe("fiscal.commercial.review_requested", event => this.consume(event), "fiscal.commercial-review.v1"); }
  async consume(event: DomainEvent) {
    const stored = event.eventId && await this.prisma.outboxMessage.findFirst({ where: { eventId: event.eventId, merchantId: event.merchantId, eventType: "fiscal.commercial.review_requested", producer: "commerce" } });
    if (!stored || !isDeepStrictEqual(stored.payload, event.payload)) throw new Error("fiscal_commercial_event_untrusted");
    const value = stored.payload as { intentId: string; environment: "homologation" | "production"; trigger: { id: string; kind: "cancelled" | "refund" | "partial_refund" } };
    await this.cancellation.commercialChange({ merchantId: stored.merchantId, environment: value.environment }, value.intentId, value.trigger);
  }
}
