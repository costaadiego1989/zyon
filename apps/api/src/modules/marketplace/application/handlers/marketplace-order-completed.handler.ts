import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { PlaceCrossStoreOrderUseCase } from "../use-cases/place-cross-store-order.use-case.js";
import { PrismaCrossStoreOrderRepository } from "../../infrastructure/repositories/prisma-cross-store-order.repository.js";
import { PrismaMarketplaceSettlementRepository } from "../../infrastructure/repositories/prisma-marketplace-settlement.repository.js";
import { PrismaMarketplaceConfigRepository } from "../../infrastructure/repositories/prisma-marketplace-config.repository.js";
import { SettlementStateMachineService } from "../../domain/services/settlement-state-machine.service.js";

@Injectable()
export class MarketplaceOrderCompletedHandler implements OnModuleInit {
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus, private readonly prisma: PrismaClient) {}
  onModuleInit() { this.events.subscribe("order.completed", event => this.handle(event), "marketplace.order-settlements.v1"); }
  async handle(event: DomainEvent) {
    const payload = event.payload as { session_id?: string; external_order_id?: string };
    if (!payload?.session_id || !payload.external_order_id) throw new Error("marketplace_order_event_invalid");
    await this.prisma.$transaction(async tx => {
      const order = await tx.completedOrder.findFirst({ where: { merchantId: event.merchantId, sessionId: payload.session_id, externalOrderId: payload.external_order_id } });
      if (!order) throw new Error("marketplace_completed_order_missing");
      // Cancelled/refunded orders must never schedule a new payout.
      if (order.status !== "approved") return;
      const session = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: event.merchantId, sessionId: payload.session_id! } } });
      if (!session) throw new Error("marketplace_checkout_missing");
      const cartRef = (session.cart as { cart_ref?: string }).cart_ref ?? session.sessionId;
      const db = tx as PrismaClient;
      await new PlaceCrossStoreOrderUseCase(new PrismaCrossStoreOrderRepository(db), new PrismaMarketplaceSettlementRepository(db), new PrismaMarketplaceConfigRepository(db), new SettlementStateMachineService()).execute({
        hostMerchantId: event.merchantId, checkoutSessionId: cartRef, orderId: order.externalOrderId, completedAt: order.completedAt,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
