import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { CancelPaymentIntentUseCase } from "./cancel-payment-intent.use-case.js";
import type { TrustedCheckoutBuyer } from "../../checkout/application/services/trusted-checkout-buyer.js";

@Injectable()
export class CancelCheckoutPaymentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly cancellation: CancelPaymentIntentUseCase,
  ) {}

  async execute(merchantId: string, sessionId: string, buyer: TrustedCheckoutBuyer): Promise<void> {
    if (!this.payments.listForSession) throw new ServiceUnavailableException("checkout_edit_unavailable");
    const intents = await this.payments.listForSession(merchantId, sessionId);
    for (const intent of intents) {
      const snapshot = intent.snapshot();
      if (["failed", "cancelled"].includes(snapshot.status)) continue;
      const result = await this.cancellation.execute({ merchantId, sessionId, intentId: snapshot.id,
        idempotencyKey: `edit_${snapshot.id}`, buyer });
      // Editing never treats provider-unknown, unsupported or paid as cancellation.
      if (result.cancellation !== "cancelled" || result.status !== "cancelled") {
        throw new ConflictException("checkout_payment_cancellation_unconfirmed");
      }
    }
  }
}
