import { Injectable, Inject } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { appendOutboxInTransaction } from "../../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import type { FulfillmentTransitionRepository } from "../../domain/ports/fulfillment-transition.repository.port.js";

@Injectable()
export class PrismaFulfillmentTransitionRepository implements FulfillmentTransitionRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async persist(input: Parameters<FulfillmentTransitionRepository["persist"]>[0]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const shipment = input.shipment;
      const statusChanged = shipment.status !== input.previousStatus;
      if (statusChanged) {
        const result = await tx.shipment.updateMany({
          where: { id: shipment.id, merchantId: shipment.merchant_id, status: input.previousStatus },
          data: {
            carrier: shipment.carrier_key,
            trackingCode: shipment.tracking_code ?? `pending:${shipment.id}`,
            trackingUrl: shipment.label_url,
            status: shipment.status,
            updatedAt: new Date(shipment.updated_at),
            estimatedEta: asDate(shipment.estimated_eta),
            deliveredAt: asDate(shipment.delivered_at),
          },
        });
        if (result.count !== 1) throw new Error("fulfillment_transition_conflict");
      } else {
        const exists = await tx.shipment.count({ where: { id: shipment.id, merchantId: shipment.merchant_id, status: input.previousStatus } });
        if (exists !== 1) throw new Error("fulfillment_transition_conflict");
      }

      await tx.trackingEvent.upsert({
        where: { id: input.trackingEvent.id },
        create: {
          id: input.trackingEvent.id,
          merchantId: shipment.merchant_id,
          shipmentId: shipment.id,
          trackingCode: shipment.tracking_code ?? `pending:${shipment.id}`,
          status: input.trackingEvent.status,
          description: input.trackingEvent.description,
          location: input.trackingEvent.location,
          carrierRaw: input.trackingEvent.carrier_raw as Prisma.InputJsonValue,
          occurredAt: new Date(input.trackingEvent.occurred_at),
        },
        update: {},
      });

      for (const event of input.outboxEvents) await appendOutboxInTransaction(tx, event);
    });
  }
}

function asDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
