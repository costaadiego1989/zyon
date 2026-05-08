import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { CompleteOrderRequest, CompleteOrderResponse } from "@aacp/shared-types";
import { CompletedOrderEntity } from "../../domain/entities/completed-order.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { planOmnichannelConfirmation } from "../../domain/policies/omnichannel-confirmation.policy.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import {
  PURCHASE_HISTORY_PORT,
  type PurchaseHistoryPort
} from "../../domain/ports/purchase-history.port.js";
import { withCheckoutTransaction } from "./checkout-transaction.js";

@Injectable()
export class CompleteOrderUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() @Inject(PURCHASE_HISTORY_PORT) private readonly purchaseHistory?: PurchaseHistoryPort
  ) {}

  async execute(input: CompleteOrderRequest): Promise<CompleteOrderResponse> {
    return withCheckoutTransaction(this.repository, async (repository) => {
      const session = await repository.getSession(input.merchant_id, input.session_id);
      if (!session) throw new NotFoundException("checkout_session_not_found");

      const order = CompletedOrderEntity.complete(input).snapshot();
      const saved = await repository.saveCompletedOrder(order);
      if (!saved.idempotent) {
        await repository.recordEvent(input.merchant_id, input.session_id, "order_completed");
        const confirmation_touchpoints = planOmnichannelConfirmation(input.order_total);
        await repository.appendOutbox(
          createCheckoutEventEnvelope({
            eventType: "order.completed",
            merchantId: input.merchant_id,
            payload: {
              session_id: input.session_id,
              external_order_id: input.external_order_id,
              order_total: input.order_total,
              currency: input.currency,
              accepted_offer_id: input.accepted_offer_id,
              tracking_code: order.trackingCode,
              confirmation_touchpoints
            },
            causationId: input.external_order_id
          })
        );
        if (session.customer?.phone) {
          await repository.appendOutbox(
            createCheckoutEventEnvelope({
              eventType: "whatsapp.message.requested",
              merchantId: input.merchant_id,
              payload: {
                session_id: input.session_id,
                phone: session.customer.phone,
                template: "order_tracking",
                external_order_id: input.external_order_id,
                tracking_code: order.trackingCode,
                message: `Pagamento confirmado. Seu codigo de rastreio e ${order.trackingCode}.`
              },
              causationId: input.external_order_id
            })
          );
        }
        await this.purchaseHistory?.recordCheckoutPurchase({
          merchantId: input.merchant_id,
          sessionId: input.session_id,
          globalUserId: session.globalUserId,
          orderId: input.external_order_id,
          currency: input.currency,
          totalAmount: input.order_total,
          discountAmount: session.cart.currentDiscount ?? 0,
          completedAt: order.completedAt,
          items: session.cart.items.map((item) => ({
            sku: item.sku,
            title: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            discountAmount: 0
          }))
        });
      }

      return {
        recorded: true,
        idempotent: saved.idempotent,
        event_type: "order.completed"
      };
    });
  }
}
