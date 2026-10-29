import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { hasMarketplaceFulfillmentFunding } from "../repositories/marketplace-fulfillment-guard.js";
import { projectShipmentFulfillment } from "../../../../shared/persistence/order-shipment-fulfillment.js";

@Injectable()
export class OnShipmentDeliveredHandler implements OnModuleInit {
  private readonly logger = new Logger(OnShipmentDeliveredHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe("shipment.status-updated", event => this.projectStatus(event), "fulfillment:shipment.status-updated");
    this.eventBus.subscribe(
      "shipment.delivered",
      (event) => this.handle(event),
      "fulfillment:shipment.delivered"
    );
  }

  private async projectStatus(event: DomainEvent): Promise<void> {
    const shipmentId = (event.payload as { shipment_id?: string }).shipment_id;
    if (!shipmentId) return;
    const shipment = await this.prisma.shipment.findFirst({ where: { id: shipmentId, merchantId: event.merchantId } });
    if (!shipment || await hasMarketplaceFulfillmentFunding(this.prisma, { merchantId: event.merchantId, orderId: shipment.externalOrderId, sessionId: shipment.sessionId })) return;
    await this.prisma.$transaction(tx => projectShipmentFulfillment(tx, event.merchantId, shipmentId));
  }

  private async handle(event: DomainEvent): Promise<void> {
    let typedOrder = false;
    try {
      const { shipment_id } = event.payload as { shipment_id?: string };
      if (!shipment_id || !event.merchantId) return;

      const shipment = await this.prisma.shipment.findFirst({ where: { id: shipment_id, merchantId: event.merchantId } });
      if (!shipment || shipment.merchantId !== event.merchantId || shipment.status !== "delivered") return;
      if (await hasMarketplaceFulfillmentFunding(this.prisma, {
        merchantId: shipment.merchantId, orderId: shipment.externalOrderId, sessionId: shipment.sessionId,
      })) return;
      const typed = await this.prisma.completedOrder.findMany({ where: { merchantId: shipment.merchantId, externalOrderId: shipment.externalOrderId }, select: { fulfillmentJson: true } });
      if (typed.some(order => order.fulfillmentJson)) {
        typedOrder = true;
        await this.prisma.$transaction(tx => projectShipmentFulfillment(tx, shipment.merchantId, shipment.id));
        return;
      }

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
      if (typedOrder) throw err;
    }
  }
}
