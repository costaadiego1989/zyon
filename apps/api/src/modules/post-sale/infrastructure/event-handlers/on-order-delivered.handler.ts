import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEvent,
} from "../../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { SchedulePostDeliveryFlowUseCase } from "../../application/use-cases/schedule-post-delivery-flow.use-case.js";

export interface OrderDeliveredEvent {
  type: "ORDER_DELIVERED";
  merchantId: string;
  orderId: string;
  buyerEmail?: string;
  buyerName?: string;
  buyerPhone?: string;
  globalUserId?: string;
}

@Injectable()
export class OnOrderDeliveredHandler implements OnModuleInit {
  private readonly logger = new Logger(OnOrderDeliveredHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly scheduleFlow: SchedulePostDeliveryFlowUseCase
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      "order.delivered",
      (event) => this.onOrderDelivered(event),
      "post-sale:order.delivered"
    );
    this.logger.log("Subscribed to order.delivered events");
  }

  private async onOrderDelivered(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as OrderDeliveredEvent;

      if (!payload.orderId) return;
      const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: event.merchantId,
        OR: [{ id: payload.orderId }, { externalOrderId: payload.orderId }] }, include: { session: true } });
      if (!order || order.status !== "delivered") return;
      const buyerId = order.session?.globalUserId || order.sessionId;
      const account = await this.prisma.buyerAccount.findUnique({ where: { globalUserId: buyerId }, select: { phone: true, email: true, displayName: true } });
      await this.scheduleFlow.execute({
        merchantId: event.merchantId,
        orderId: order.externalOrderId,
        buyerId,
        buyerEmail: account?.email || payload.buyerEmail,
        buyerName: account?.displayName || payload.buyerName,
        buyerPhone: account?.phone || payload.buyerPhone,
        productName: "seu pedido",
      });

      this.logger.log(
        "Scheduled post-delivery flow",
        {
          merchantId: event.merchantId,
          orderId: payload.orderId,
          buyerId,
        }
      );
    } catch (err) {
      this.logger.error(
        "Failed to handle order.delivered event",
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
  }
}
