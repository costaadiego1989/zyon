import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { CompleteOrderRequest, CompleteOrderResponse } from "@aacp/shared-types";
import { CompletedOrderEntity } from "../../domain/entities/completed-order.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { planOmnichannelConfirmation } from "../../domain/policies/omnichannel-confirmation.policy.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../domain/ports/order.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import {
  PURCHASE_HISTORY_PORT,
  type PurchaseHistoryPort
} from "../../domain/ports/purchase-history.port.js";

@Injectable()
export class CompleteOrderUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(PURCHASE_HISTORY_PORT) private readonly purchaseHistory?: PurchaseHistoryPort
  ) { }

  async execute(input: CompleteOrderRequest): Promise<CompleteOrderResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const order = CompletedOrderEntity.complete(input).snapshot();
    const saved = await this.orders.saveCompletedOrder(order);
    if (!saved.idempotent) {
      await this.sessions.recordEvent(input.merchant_id, input.session_id, "order_completed");
      const confirmation_touchpoints = planOmnichannelConfirmation(input.order_total);
      await this.outbox.appendOutbox(
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
        const messageText = `Olá ${session.customer.fullName || "Cliente"}! Seu pagamento foi confirmado com sucesso. Seu pedido foi processado e o código de rastreio é: ${order.trackingCode}. Obrigado por comprar conosco!`;

        await this.outbox.appendOutbox(
          createCheckoutEventEnvelope({
            eventType: "whatsapp.message.requested",
            merchantId: input.merchant_id,
            payload: {
              session_id: input.session_id,
              phone: session.customer.phone,
              template: "order_tracking",
              external_order_id: input.external_order_id,
              tracking_code: order.trackingCode,
              message: messageText
            },
            causationId: input.external_order_id
          })
        );

        const bubbleUrl = process.env.BUBBLEWHATS_API_URL;
        const bubbleToken = process.env.BUBBLEWHATS_TOKEN;
        if (bubbleUrl && bubbleToken) {
          try {
            const cleanDigits = session.customer.phone.replace(/\D/g, "");
            const jid = cleanDigits.startsWith("55") ? cleanDigits : `55${cleanDigits}`;

            const response = await fetch(`${bubbleUrl}/send-message`, {
              method: "POST",
              headers: {
                "Authorization": bubbleToken,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                jid,
                message: messageText
              })
            });

            if (response.ok) {
              console.log(`[BubbleWhats] Message sent successfully to ${jid}`);
            } else {
              const errText = await response.text();
              console.error(`[BubbleWhats] Failed to send message. Status: ${response.status}. Response: ${errText}`);
            }
          } catch (err) {
            console.error("[BubbleWhats] Error sending WhatsApp message:", err);
          }
        }
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
  }
}
