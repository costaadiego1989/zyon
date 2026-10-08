import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { PlaceCrossStoreOrderUseCase } from "../use-cases/place-cross-store-order.use-case.js";
import { HandleMarketplaceChargebackUseCase } from "../use-cases/handle-marketplace-chargeback.use-case.js";
import { FundMarketplaceOrderUseCase } from "../use-cases/fund-marketplace-order.use-case.js";

@Injectable()
export class MarketplaceFinancialEventsHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    private readonly prisma: PrismaClient,
    private readonly placeOrder: PlaceCrossStoreOrderUseCase,
    private readonly chargeback: HandleMarketplaceChargebackUseCase,
    @Optional() private readonly funding?: FundMarketplaceOrderUseCase,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe("order.completed", event => this.onOrder(event), "marketplace.order-settlements.v1");
    this.bus.subscribe("payment.status.changed", event => this.onPayment(event), "marketplace.chargeback.v1");
  }

  private async onOrder(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    if (typeof p?.session_id !== "string" || typeof p.external_order_id !== "string") {
      throw new Error("marketplace_order_event_invalid");
    }
    const order = await this.prisma.completedOrder.findUnique({ where: { merchantId_sessionId_externalOrderId: {
      merchantId: event.merchantId, sessionId: p.session_id, externalOrderId: p.external_order_id,
    } } });
    if (!order) throw new Error("marketplace_completed_order_missing");
    const plan = await this.prisma.marketplaceFundingPlan.findFirst({ where: { hostMerchantId: event.merchantId,
      payment: { merchantId: event.merchantId, providerPaymentId: order.externalOrderId } }, include: { payment: true } });
    if (plan && plan.payment.sessionId !== order.sessionId) throw new Error("marketplace_inventory_order_scope_mismatch");
    await this.placeOrder.execute({ hostMerchantId: event.merchantId, orderId: order.externalOrderId,
      checkoutSessionId: plan?.checkoutSessionId ?? (typeof p.marketplace_checkout_session_id === "string" ? p.marketplace_checkout_session_id : order.sessionId),
      purchasedAt: order.completedAt });
    await this.funding?.execute(event.merchantId, order.externalOrderId);
  }

  private async onPayment(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    if (typeof p?.status !== "string" || !p.status.startsWith("chargeback_")) return;
    if (typeof p.payment_intent_id !== "string") throw new Error("marketplace_dispute_intent_required");
    const intent = await this.prisma.paymentIntent.findFirst({ where: { id: p.payment_intent_id, merchantId: event.merchantId } });
    if (!intent || !intent.status.startsWith("chargeback_") || !intent.providerPaymentId) {
      throw new Error("marketplace_dispute_payment_mismatch");
    }
    if (intent.status === "chargeback_won") {
      const ledger = await this.prisma.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: {
        hostMerchantId: event.merchantId, orderId: intent.providerPaymentId,
      } } });
      const plan = await this.prisma.marketplaceFundingPlan.findUnique({ where: { paymentIntentId: intent.id } });
      // A won dispute is not a new loss. Preserve existing holds/debts until the
      // returned provider balance and any prior reversals are reconciled.
      if (ledger || plan) throw new Error("marketplace_won_dispute_requires_reconciliation");
      return;
    }
    // The checkout order uses the provider payment ID, not the session ID.
    // Exceptions reach the outbox worker, preserving retries and dead-letter alerts.
    await this.chargeback.executeForOrder(intent.providerPaymentId, event.merchantId);
  }
}
