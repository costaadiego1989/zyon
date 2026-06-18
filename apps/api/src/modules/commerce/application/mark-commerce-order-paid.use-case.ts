import { Inject, Injectable } from "@nestjs/common";
import { COMMERCE_ORDER_PORT, type CommerceOrderPort } from "../domain/ports/commerce-order.port.js";
import {
  COMMERCE_PAID_WEBHOOK_DEDUP,
  type CommercePaidWebhookDedupPort
} from "../domain/ports/commerce-paid-webhook-dedup.port.js";
import { createCommerceEventEnvelope } from "../domain/events/commerce-domain-event.js";

export type MarkCommerceOrderPaidInput = {
  merchantId: string;
  commerceOrderId: string;
  paymentReference: string;
};

export type MarkCommerceOrderPaidOutput = {
  /** Verdadeiro quando `commerce.markOrderPaid` foi invocado nesta execução. */
  invokedCommerceSync: boolean;
};

@Injectable()
export class MarkCommerceOrderPaidUseCase {
  constructor(
    @Inject(COMMERCE_ORDER_PORT)
    private readonly orders: CommerceOrderPort,
    @Inject(COMMERCE_PAID_WEBHOOK_DEDUP)
    private readonly dedup: CommercePaidWebhookDedupPort
  ) {}

  async execute(input: MarkCommerceOrderPaidInput): Promise<MarkCommerceOrderPaidOutput> {
    const merchantId = input.merchantId.trim();
    const paymentReference = input.paymentReference.trim();
    const commerceOrderId = input.commerceOrderId.trim();

    // P1 fix: reserve the dedup row BEFORE calling the provider.
    // tryReserve performs an atomic insert; concurrent duplicates collide on the
    // unique constraint and return false, preventing double payment marking.
    const reserved = await this.dedup.tryReserve(merchantId, paymentReference);
    if (!reserved) {
      return { invokedCommerceSync: false };
    }

    await this.orders.markOrderPaid({
      merchantId,
      commerceOrderId,
      paymentReference
    });

    const event = createCommerceEventEnvelope({
      eventType: "commerce.order.paid",
      merchantId,
      payload: {
        commerce_order_id: commerceOrderId,
        payment_reference: paymentReference
      }
    });
    // Persist final commerceOrderId + outbox event atomically now that the
    // provider call succeeded.
    await this.dedup.markProcessed(merchantId, paymentReference, commerceOrderId, event);
    return { invokedCommerceSync: true };
  }
}
