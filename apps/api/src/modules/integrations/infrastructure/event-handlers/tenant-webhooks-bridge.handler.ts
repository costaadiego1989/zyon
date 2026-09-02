import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { TenantWebhookPublisher } from "../../application/integrations.use-cases.js";
import { WebhookDeliveryDispatcher } from "../../application/webhook-delivery-dispatcher.service.js";
import type { TenantWebhookEventType } from "../../domain/integrations.types.js";

/**
 * Bridges internal domain events (delivered via the outbox → domain event bus)
 * to the merchant-facing tenant webhook catalog. Without this, several events
 * that the dashboard lets merchants subscribe to (checkout.started,
 * checkout.abandoned, payment.*) had no producer and never fired.
 *
 * Order lifecycle (order.created/approved/customer.upserted) is handled by
 * TenantWebhooksOnCheckoutHandler; this handler covers the rest.
 */
@Injectable()
export class TenantWebhooksBridgeHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly publisher: TenantWebhookPublisher,
    private readonly dispatcher: WebhookDeliveryDispatcher,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "checkout.session.started",
      (event) => this.handleCheckoutStarted(event),
      "integrations.TenantWebhooksBridge.checkoutStarted",
    );
    this.eventBus.subscribe(
      "checkout.abandoned",
      (event) => this.handleCheckoutAbandoned(event),
      "integrations.TenantWebhooksBridge.checkoutAbandoned",
    );
    this.eventBus.subscribe(
      "payment.status.changed",
      (event) => this.handlePaymentStatusChanged(event),
      "integrations.TenantWebhooksBridge.paymentStatusChanged",
    );
    this.eventBus.subscribe(
      "commerce.connection.degraded",
      (event) => this.handleCommerceConnectionDegraded(event),
      "integrations.TenantWebhooksBridge.commerceConnectionDegraded",
    );
  }

  private async handleCheckoutStarted(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    await this.emit(event.merchantId, "checkout.started", {
      session_id: p["session_id"],
      conversation_id: p["conversation_id"] ?? null,
      global_user_id: p["global_user_id"] ?? null,
      cart_total: p["cart_total"] ?? null,
      currency: p["currency"] ?? null,
    });
  }

  private async handleCheckoutAbandoned(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    await this.emit(event.merchantId, "checkout.abandoned", {
      session_id: p["session_id"],
      abandonment_score: p["abandonment_score"] ?? null,
    });
  }

  private async handlePaymentStatusChanged(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    const status = String(p["status"] ?? "");
    // Map the internal PaymentIntentStatus to the tenant webhook catalog.
    // requires_action/cancelled have no merchant-facing event and are skipped.
    const mapped: Partial<Record<string, TenantWebhookEventType>> = {
      pending: "payment.pending",
      approved: "payment.approved",
      failed: "payment.failed",
      refunded: "payment.refunded",
    };
    const eventType = mapped[status];
    if (!eventType) return;

    await this.emit(event.merchantId, eventType, {
      session_id: p["session_id"] ?? null,
      payment_intent_id: p["payment_intent_id"] ?? null,
      status,
      amount_cents: p["amount_cents"] ?? null,
      method: p["method"] ?? null,
      commerce_order_id: p["commerce_order_id"] ?? null,
    });
  }

  private async handleCommerceConnectionDegraded(event: DomainEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    await this.emit(event.merchantId, "commerce.connection.degraded", {
      error_code: p["error_code"] ?? null,
      occurred_at: p["occurred_at"] ?? null,
    });
  }

  private async emit(
    merchantId: string,
    eventType: TenantWebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const deliveries = await this.publisher.publish({ merchantId, eventType, data });
    for (const delivery of deliveries) {
      try {
        await this.dispatcher.dispatchDelivery(delivery);
      } catch {
        // queued delivery remains pending for background retry
      }
    }
  }
}
