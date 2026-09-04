import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class OnShipmentDeliveredHandler implements OnModuleInit {
  private readonly logger = new Logger(OnShipmentDeliveredHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      "shipment.delivered",
      (event) => this.handle(event),
      "fulfillment:shipment.delivered"
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    try {
      const { shipment_id, delivered_at } = event.payload as { shipment_id: string; delivered_at: string };

      const shipment = await this.prisma.shipment.findUnique({ where: { id: shipment_id } });
      if (!shipment) return;

      // Update CompletedOrder status to "delivered"
      await this.prisma.completedOrder.updateMany({
        where: {
          merchantId: shipment.merchantId,
          externalOrderId: shipment.externalOrderId,
          status: { in: ["shipped", "approved", "paid"] },
        },
        data: { status: "delivered" },
      });

      // Emit order.delivered for post-sale (triggers follow-up, review, NPS, cross-sell)
      await this.eventBus.publish({
        eventType: "order.delivered",
        merchantId: shipment.merchantId,
        payload: {
          type: "ORDER_DELIVERED",
          merchantId: shipment.merchantId,
          orderId: shipment.externalOrderId,
        },
      });

      this.logger.log(`Order marked delivered for shipment ${shipment_id}`);
    } catch (err) {
      this.logger.error("Failed to mark order delivered", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
