import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { marketplaceShippingContractHash } from "../../domain/marketplace-shipping-contract.js";
import { PrismaMarketplaceDeliveryRepository } from "../../infrastructure/repositories/prisma-marketplace-delivery.repository.js";

/** The origin event wakes a database reconciliation; its payload never proves delivery. */
@Injectable()
export class MarketplaceDeliveryEventsHandler implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceDeliveryEventsHandler.name);
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly delivery: PrismaMarketplaceDeliveryRepository) {}

  onModuleInit(): void {
    this.bus.subscribe("marketplace.shipment.origin_delivered", event => this.handle(event), "marketplace.delivery.v1");
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | null;
    const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
    if (!validId(event.eventId) || !validId(event.merchantId) || event.schemaVersion !== 1 || !payload ||
        !validId(payload.funding_plan_id) || !validId(payload.origin_merchant_id) ||
        !Number.isSafeInteger(payload.volume_count) || Number(payload.volume_count) < 1 || Number(payload.volume_count) > 100 ||
        !Array.isArray(payload.shipment_ids) || payload.shipment_ids.length !== payload.volume_count ||
        !payload.shipment_ids.every(validId) || new Set(payload.shipment_ids).size !== payload.shipment_ids.length ||
        event.correlationId !== payload.funding_plan_id || event.causationId !== payload.origin_merchant_id ||
        event.eventId !== `mship_origin_delivered_${marketplaceShippingContractHash([event.merchantId, payload.funding_plan_id, payload.origin_merchant_id])}`) {
      throw new Error("marketplace_delivery_event_invalid");
    }
    const stored = await this.prisma.outboxMessage.findFirst({ where: { eventId: event.eventId, merchantId: event.merchantId } });
    if (!stored || stored.eventType !== event.eventType || stored.schemaVersion !== 1 || stored.merchantId !== event.merchantId ||
        stored.producer !== "marketplace-shipping" || stored.correlationId !== event.correlationId ||
        stored.causationId !== event.causationId || !isDeepStrictEqual(stored.payload, payload)) {
      throw new Error("marketplace_delivery_event_mismatch");
    }
    const result = await this.delivery.complete({ hostMerchantId: event.merchantId, paymentIntentId: payload.funding_plan_id });
    // Retry/dead-letter metrics must expose an unsupported mixed-order delivery,
    // not acknowledge it as a globally completed order. Physical facts remain saved.
    if (result.status === "incomplete" && result.reason === "non_physical_evidence_required") {
      throw new Error("marketplace_delivery_non_physical_evidence_required");
    }
    this.logger.log({ event: "marketplace.delivery_reconciled", event_id: event.eventId, outcome: result.status });
  }
}
