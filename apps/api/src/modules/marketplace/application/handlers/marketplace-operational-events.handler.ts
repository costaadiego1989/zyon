import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";

/** These events describe facts already committed by marketplace journals.
 * Delivery here is local operational observation, never provider/ERP delivery. */
export const MARKETPLACE_OPERATIONAL_EVENT_TYPES = [
  "marketplace.refund.confirmed", "marketplace.recovery.reconciliation_required",
  "marketplace.refund.contribution_approved", "marketplace.refund.contribution_credited",
  "marketplace.asaas_wallet_return.returned", "marketplace.asaas_residual_wallet_return.returned", "marketplace.refund.funding_ready",
  "marketplace.contribution_checkout_approved", "marketplace.contribution_checkout_submitted",
  "marketplace.contribution_checkout_paid", "marketplace.contribution_checkout_expired", "marketplace.contribution_excess_returned",
  "marketplace.seller_fee_collection_approved", "marketplace.seller_fee_collection_submitted", "marketplace.seller_fee_collection_paid",
  "marketplace.seller_fee_collection_expired", "marketplace.seller_fee_collection_credited",
  "marketplace.seller_dispute_obligation_closed",
  "marketplace.host_fee_collection_approved", "marketplace.host_fee_collection_submitted", "marketplace.host_fee_collection_paid",
  "marketplace.host_fee_collection_expired", "marketplace.host_fee_collection_credited", "marketplace.host_dispute_obligation_closed",
  "marketplace.host_principal_extinguished", "marketplace.order_dispute_closed",
  "marketplace.residual.prepared", "marketplace.residual.confirmed", "marketplace.residual.failed",
  "marketplace.residual.generation_certified", "marketplace.asaas_host_retention.certified",
  "marketplace.transfer_reversal.confirmed", "marketplace.transfer_recovery.confirmed", "marketplace.cancellation.prepared", "marketplace.cancellation.blocked",
  "marketplace.transfer_recovery_credit.confirmed",
  "marketplace.dispute.closure_observed",
  "marketplace.debt.principal_extinguished", "marketplace.financial_reconciliation_required",
  "marketplace.asaas_residual.submission_authorized",
  "marketplace.cancellation.removal_observed", "marketplace.cancellation.reactivated",
  "marketplace.shipment.cart_created", "marketplace.shipment.tracking_updated", "marketplace.shipment.purchased",
  "marketplace.shipment.generated", "marketplace.shipment.reconciliation_required", "marketplace.shipment.print_link_obtained",
  "marketplace.shipment.canceled", "marketplace.shipment.carrier_order_recovered",
  "marketplace.shipment.origin_delivered",
  "marketplace.shipment.financial_reconciliation_required",
  "marketplace.delivery.completed",
] as const;

@Injectable()
export class MarketplaceOperationalEventsHandler implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceOperationalEventsHandler.name);
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    for (const type of MARKETPLACE_OPERATIONAL_EVENT_TYPES) {
      this.bus.subscribe(type, event => this.observe(event), `marketplace.operational-observation.v1:${type}`);
    }
  }

  private async observe(event: DomainEvent): Promise<void> {
    if (!event.eventId || event.schemaVersion !== 1 || !event.merchantId) throw new Error("marketplace_operational_event_invalid");
    const stored = await this.prisma.outboxMessage.findFirst({ where: { eventId: event.eventId, merchantId: event.merchantId } });
    if (!stored || stored.merchantId !== event.merchantId || stored.eventType !== event.eventType || stored.schemaVersion !== event.schemaVersion ||
        !["marketplace", "marketplace-shipping"].includes(stored.producer) || stored.correlationId !== event.correlationId ||
        stored.causationId !== event.causationId || !isDeepStrictEqual(stored.payload, event.payload)) {
      throw new Error("marketplace_operational_event_mismatch");
    }
    // Never log the payload: it can include provider identifiers or private links.
    // Dispatcher receipts provide durable per-handler deduplication. A crash before
    // acknowledgement can repeat this log; no commerce action is performed here.
    this.logger.log({ event: "marketplace.operational_event_observed", event_type: stored.eventType, event_id: stored.eventId });
  }
}
