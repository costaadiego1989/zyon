import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { HandleSaleCompletedUseCase } from "../../application/use-cases/handle-sale-completed.use-case.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { validateInventorySale, validId } from "../../domain/events/inventory-sale.validation.js";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";

@Injectable()
export class InventoryOnOrderCompletedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(HandleSaleCompletedUseCase) private readonly handleSaleCompleted: HandleSaleCompletedUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkoutSessions: CheckoutSessionRepository,
  ) {}
  onModuleInit(): void {
    this.eventBus.subscribe("order.completed", event => this.handle(event), "inventory.InventoryOnOrderCompletedHandler");
  }
  async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | undefined;
    const merchantId = event.merchantId;
    if (!payload || !validId(merchantId) || !validId(payload.external_order_id) || !validId(payload.session_id)) throw new Error("inventory_order_event_invalid");
    const orderId = payload.external_order_id;
    const snapshot = payload.inventory_sale as (Omit<SaleCompletedEvent, "merchantId" | "orderId"> & { version: number }) | undefined;
    if (snapshot !== undefined) {
      if (snapshot.version !== 1) throw new Error("inventory_sale_snapshot_version_unsupported");
      // Tenant/order identity always comes from the domain envelope, never nested data.
      await this.handleSaleCompleted.execute(validateInventorySale({ ...snapshot, merchantId, orderId }));
      return;
    }
    // Legacy events lack a durable sale snapshot. Resolve via the required checkout port;
    // unreadable/missing sessions fail so outbox can retry, rather than dropping stock.
    const session = await this.checkoutSessions.getSession(merchantId, payload.session_id);
    if (!session || session.merchantId !== merchantId || session.sessionId !== payload.session_id) throw new Error("inventory_checkout_session_not_found");
    if (typeof payload.order_total !== "number" || !Number.isFinite(payload.order_total) || payload.order_total < 0) throw new Error("inventory_sale_total_invalid");
    await this.handleSaleCompleted.execute(validateInventorySale({ merchantId, orderId,
      items: session.cart.items.map(item => ({ sku: item.sku, quantity: item.quantity })),
      buyerEmail: session.customer?.email, buyerName: session.customer?.fullName, buyerPhone: session.customer?.phone,
      totalCents: Math.round(payload.order_total * 100), timestamp: new Date().toISOString() }));
  }
}
