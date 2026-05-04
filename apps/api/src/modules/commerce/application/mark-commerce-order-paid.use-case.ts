import { Inject, Injectable } from "@nestjs/common";
import { COMMERCE_ORDER_PORT, type CommerceOrderPort } from "../domain/ports/commerce-order.port.js";
import {
  COMMERCE_PAID_WEBHOOK_DEDUP,
  type CommercePaidWebhookDedupPort
} from "../domain/ports/commerce-paid-webhook-dedup.port.js";

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

    if (await this.dedup.isProcessed(merchantId, paymentReference)) {
      return { invokedCommerceSync: false };
    }

    await this.orders.markOrderPaid({
      merchantId,
      commerceOrderId,
      paymentReference
    });
    await this.dedup.markProcessed(merchantId, paymentReference);
    return { invokedCommerceSync: true };
  }
}
