import { Inject, Injectable , Logger} from "@nestjs/common";
import type { TrustedCartSnapshot } from "@zyon/commerce-adapters";
import { COMMERCE_ORDER_PORT, type CommerceOrderPort } from "../domain/ports/commerce-order.port.js";
import {
  COMMERCE_PENDING_ORDER_INDEX,
  type PendingCommerceOrderIndexPort
} from "../domain/ports/pending-commerce-order-index.port.js";
import { createCommerceEventEnvelope } from "../domain/events/commerce-domain-event.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

export type SyncPendingOrderInput = {
  merchantId: string;
  sessionId: string;
  cart: TrustedCartSnapshot;
};

export type SyncPendingOrderOutput = {
  commerceOrderId: string;
};

@Injectable()
export class SyncPendingOrderUseCase {
  private readonly logger = new Logger(SyncPendingOrderUseCase.name);

  constructor(
    @Inject(COMMERCE_ORDER_PORT)
    private readonly orders: CommerceOrderPort,
    @Inject(COMMERCE_PENDING_ORDER_INDEX)
    private readonly index: PendingCommerceOrderIndexPort
  ) {}

  async execute(input: SyncPendingOrderInput): Promise<SyncPendingOrderOutput> {
    const merchantId = input.merchantId.trim();
    const sessionId = input.sessionId.trim();

    const existing = await this.index.find(merchantId, sessionId);
    if (existing !== undefined) {
      return { commerceOrderId: existing };
    }

    const { commerceOrderId } = await this.orders.createPendingOrder({
      merchantId,
      sessionId,
      cart: input.cart
    });
    const event = createCommerceEventEnvelope({
      eventType: "commerce.order.pending",
      merchantId,
      payload: {
        commerce_order_id: commerceOrderId,
        session_id: sessionId,
        currency: input.cart.currency,
        total_cents: input.cart.totalCents
      }
    });
    await this.index.remember(merchantId, sessionId, commerceOrderId, event);
    return { commerceOrderId };
  }
}
