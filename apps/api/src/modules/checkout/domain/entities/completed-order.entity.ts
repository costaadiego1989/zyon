import type { CompletedOrder, CompleteOrderRequest } from "@aacp/shared-types";

export class CompletedOrderEntity {
  private constructor(private readonly props: CompletedOrder) {}

  static complete(input: CompleteOrderRequest, now = new Date()): CompletedOrderEntity {
    const trackingCode = input.tracking_code?.trim() || undefined;

    return new CompletedOrderEntity({
      merchantId: input.merchant_id,
      sessionId: input.session_id,
      externalOrderId: input.external_order_id,
      orderTotal: input.order_total,
      currency: input.currency,
      acceptedOfferId: input.accepted_offer_id,
      trackingCode,
      completedAt: now.toISOString()
    });
  }

  static idempotencyKey(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
  }): string {
    return `${input.merchantId}:${input.sessionId}:${input.externalOrderId}`;
  }

  snapshot(): CompletedOrder {
    return { ...this.props };
  }
}
