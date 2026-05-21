import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../../checkout/domain/ports/order.repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { TenantWebhookPublisher } from "../../application/integrations.use-cases.js";

@Injectable()
export class TenantWebhooksOnCheckoutHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    private readonly publisher: TenantWebhookPublisher
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe("order.completed", (event) => this.handleOrderCompleted(event));
  }

  private async handleOrderCompleted(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const sessionId = payload["session_id"] as string | undefined;
    const externalOrderId = payload["external_order_id"] as string | undefined;
    if (!sessionId || !externalOrderId) return;

    const [session, order] = await Promise.all([
      this.sessions.getSession(event.merchantId, sessionId),
      this.orders.getCompletedOrder(event.merchantId, sessionId, externalOrderId)
    ]);
    if (!order) return;

    await this.publisher.publish({
      merchantId: event.merchantId,
      eventType: "order.approved",
      occurredAt: order.completedAt,
      data: {
        order: {
          external_order_id: order.externalOrderId,
          session_id: order.sessionId,
          completed_at: order.completedAt,
          total: order.orderTotal,
          currency: order.currency,
          status: "approved"
        },
        items: session?.cart.items.map((item) => ({
          sku: item.sku,
          title: item.name,
          quantity: item.quantity,
          unit_price: item.price,
          image_url: item.imageUrl ?? null,
          variant: item.variant ?? null
        })) ?? [],
        totals: {
          subtotal: session?.cart.total ?? order.orderTotal,
          discount: session?.cart.currentDiscount ?? 0,
          freight: session?.shipping?.customerPrice ?? 0,
          total: order.orderTotal,
          currency: order.currency
        },
        freight: session?.shipping ?? null,
        customer: session?.customer ?? null,
        payment: {
          status: "approved",
          amount: order.orderTotal,
          currency: order.currency,
          provider_reference: order.externalOrderId
        },
        tracking: {
          tracking_code: order.trackingCode ?? null,
          status: order.trackingCode ? "label_generated" : "pending"
        }
      }
    });

    if (session?.customer) {
      await this.publisher.publish({
        merchantId: event.merchantId,
        eventType: "customer.upserted",
        occurredAt: order.completedAt,
        data: {
          customer: session.customer,
          session_id: session.sessionId,
          external_order_id: order.externalOrderId,
          global_user_id: session.globalUserId
        }
      });
    }
  }
}
