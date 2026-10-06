import { Injectable, Inject, BadRequestException, Optional, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { readFulfillment } from "../../../operations/domain/order-fulfillment.js";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import { SHIPMENT_REPOSITORY, type ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createFulfillmentEventEnvelope } from "../../domain/events/fulfillment-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class CreateShipmentUseCase {
  private readonly logger = new Logger(CreateShipmentUseCase.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY) private readonly repo: ShipmentRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async execute(input: { merchant_id: string; order_id: string; carrier_key: string }) {
    // M2 fix: validate inputs before persistence.
    if (!input.merchant_id?.trim()) {
      throw new BadRequestException("merchant_id_required");
    }
    if (!input.order_id?.trim()) {
      throw new BadRequestException("order_id_required");
    }
    if (this.prisma) {
      const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchant_id, externalOrderId: input.order_id } });
      if (order && (order.fulfillmentJson || Array.isArray(order.lineItemsJson) && order.lineItemsJson.some(line => line && typeof line === "object" && !Array.isArray(line) && line.snapshotVersion === 2))) {
        if (!readFulfillment(order.fulfillmentJson)?.units.some(unit => unit.strategy === "carrier")) throw new BadRequestException("order_carrier_fulfillment_required");
      }
    }

    // P1 fix: check for an existing shipment for this order before creating.
    // The fulfillment handler subscribes to `order.completed` on an in-process
    // DomainEventBus that delivers at-least-once. Without this guard, a
    // redelivered event creates a duplicate shipment for the same order.
    const existing = await this.repo.findByOrderId(input.order_id, input.merchant_id);
    if (existing !== null) {
      return existing.snapshot();
    }

    const shipment = ShipmentEntity.create(input);
    await this.repo.save(shipment);

    await this.outbox.appendOutbox(
      createFulfillmentEventEnvelope({
        eventType: "shipment.created",
        merchantId: input.merchant_id,
        payload: {
          shipment_id: shipment.id,
          order_id: input.order_id,
          merchant_id: input.merchant_id,
          carrier_key: input.carrier_key
        }
      })
    );

    return shipment.snapshot();
  }
}
