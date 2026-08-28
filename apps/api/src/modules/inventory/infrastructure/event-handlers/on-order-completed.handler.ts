import { Injectable, Inject, OnModuleInit, Logger, Optional } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { HandleSaleCompletedUseCase } from "../../application/use-cases/handle-sale-completed.use-case.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";

const logger = new Logger("InventoryOnOrderCompletedHandler");

/**
 * Adapter: listens to `order.completed` events (from checkout module),
 * resolves order items from the checkout session,
 * and calls HandleSaleCompletedUseCase to drive inventory decrement + ERP push + webhooks + CRM.
 */
@Injectable()
export class InventoryOnOrderCompletedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly handleSaleCompleted: HandleSaleCompletedUseCase,
    // Token is a Symbol — injecting the string "CHECKOUT_SESSION_REPOSITORY"
    // never matched, so session items were never resolved and stock never
    // decremented. Use the imported symbol.
    @Optional() @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkoutSessions?: CheckoutSessionRepository
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "order.completed",
      (event) => this.handle(event),
      "inventory.InventoryOnOrderCompletedHandler"
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const merchantId = event.merchantId;
    const sessionId = payload["session_id"] as string | undefined;
    const externalOrderId = payload["external_order_id"] as string | undefined;
    const orderTotal = payload["order_total"] as number | undefined;
    const currency = payload["currency"] as string | undefined;

    if (!merchantId || !sessionId || !externalOrderId || !orderTotal) {
      logger.warn(`Incomplete order.completed event data`, { merchantId, sessionId, externalOrderId });
      return;
    }

    try {
      // Phase 2: resolve buyer data and items from checkout session
      // For now, we emit a basic SaleCompletedEvent; full item resolution requires session repo wiring.
      let buyerEmail: string | undefined;
      let buyerName: string | undefined;
      let buyerPhone: string | undefined;
      let items: Array<{ sku: string; quantity: number; variantId?: string }> = [];

      if (this.checkoutSessions) {
        try {
          const session = await this.checkoutSessions.getSession(merchantId, sessionId);
          if (session) {
            buyerEmail = session.customer?.email;
            buyerName = session.customer?.fullName;
            buyerPhone = session.customer?.phone;
            items = session.cart?.items?.map((item: any) => ({
              sku: item.sku,
              quantity: item.quantity,
              variantId: item.variantId
            })) || [];
          }
        } catch (err: unknown) {
          logger.warn(`Failed to resolve session for inventory sync`, {
            merchantId,
            sessionId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      // Call the orchestrator
      await this.handleSaleCompleted.execute({
        merchantId,
        orderId: externalOrderId,
        items,
        buyerEmail,
        buyerName,
        buyerPhone,
        totalCents: Math.round(orderTotal * 100), // BRL→cents
        timestamp: new Date().toISOString()
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Inventory handler failed for sale: ${errorMsg}`, {
        merchantId,
        externalOrderId,
        sessionId,
        error: err instanceof Error ? err.stack : undefined
      });
      // Do NOT re-throw: the sale is already complete in checkout
    }
  }
}
