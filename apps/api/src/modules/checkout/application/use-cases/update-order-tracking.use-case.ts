import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UpdateOrderTrackingRequest, UpdateOrderTrackingResponse } from "@aacp/shared-types";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../domain/ports/order.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";

@Injectable()
export class UpdateOrderTrackingUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: UpdateOrderTrackingRequest): Promise<UpdateOrderTrackingResponse> {
    const trackingCode = input.tracking_code.trim();
    if (!trackingCode) throw new BadRequestException("tracking_code_required");

    const existing = await this.orders.getCompletedOrder(
      input.merchant_id,
      input.session_id,
      input.external_order_id
    );
    if (!existing) throw new NotFoundException("completed_order_not_found");

    if (existing.trackingCode === trackingCode) {
      return {
        updated: true,
        changed: false,
        event_type: "order.tracking.updated",
        order: existing
      };
    }

    const order = await this.orders.updateCompletedOrderTracking({
      merchantId: input.merchant_id,
      sessionId: input.session_id,
      externalOrderId: input.external_order_id,
      trackingCode
    });
    if (!order) throw new NotFoundException("completed_order_not_found");

    await this.outbox.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "order.tracking.updated",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          external_order_id: input.external_order_id,
          tracking_code: trackingCode
        },
        causationId: input.external_order_id
      })
    );

    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (session?.customer?.phone) {
      const messageText = `Olá ${session.customer.fullName || "Cliente"}! Seu pedido já tem código de rastreio: ${trackingCode}.`;
      await this.outbox.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "whatsapp.message.requested",
          merchantId: input.merchant_id,
          payload: {
            session_id: input.session_id,
            phone: session.customer.phone,
            template: "order_tracking",
            external_order_id: input.external_order_id,
            tracking_code: trackingCode,
            message: messageText
          },
          causationId: input.external_order_id
        })
      );
    }

    return {
      updated: true,
      changed: true,
      event_type: "order.tracking.updated",
      order
    };
  }
}
