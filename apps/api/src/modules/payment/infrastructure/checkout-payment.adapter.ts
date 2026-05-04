import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../checkout/domain/ports/checkout-repository.port.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";

@Injectable()
export class CheckoutPaymentAdapter implements CheckoutPaymentPort {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly checkoutRepository: CheckoutRepository,
    private readonly completeOrder: CompleteOrderUseCase
  ) {}

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    await this.completeOrder.execute({
      merchant_id: input.merchantId,
      session_id: input.sessionId,
      external_order_id: input.externalOrderId,
      order_total: input.orderTotalMajorUnits,
      currency: input.currency,
      accepted_offer_id: input.acceptedOfferId
    });
  }

  async recordPaymentFailure({
    merchantId,
    sessionId,
    reason: _reason
  }: {
    merchantId: string;
    sessionId: string;
    reason: string;
  }): Promise<void> {
    void _reason;
    await this.checkoutRepository.recordEvent(merchantId, sessionId, "payment_failed");
  }
}
