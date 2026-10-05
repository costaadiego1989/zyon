import { ConflictException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { savePaymentTransition } from "./services/save-payment-transition.js";

@Injectable()
export class CancelCheckoutPaymentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
  ) {}

  async execute(merchantId: string, sessionId: string): Promise<void> {
    if (!this.payments.listForSession) throw new ServiceUnavailableException("checkout_edit_unavailable");
    const intents = await this.payments.listForSession(merchantId, sessionId);
    for (const intent of intents) {
      const snapshot = intent.snapshot();
      if (["failed", "cancelled"].includes(snapshot.status)) continue;
      if (snapshot.status !== "requires_action" || !snapshot.providerPaymentId || !snapshot.creation?.input.provider) {
        throw new ConflictException("checkout_payment_not_editable");
      }
      if (!this.provider.cancelPayment) throw new ServiceUnavailableException("checkout_payment_cancellation_unavailable");
      const route = snapshot.creation.input;
      const result = await this.provider.cancelPayment({
        merchantId, providerPaymentId: snapshot.providerPaymentId, provider: route.provider,
        providerAccountFingerprint: route.providerAccountFingerprint, settlementMode: route.settlementMode,
        stripeConnectAccountId: route.stripeConnectAccountId, stripeChargeMode: route.stripeChargeMode,
      });
      if (result.state !== "cancelled") throw new ConflictException("checkout_payment_cancellation_unconfirmed");
      intent.markCancelled("buyer_edit_checkout");
      try { await savePaymentTransition(this.payments, intent, "buyer_edit_checkout"); }
      catch (error) {
        // A simultaneous cancellation/webhook can win. Never overwrite approval.
        const current = await this.payments.getIntentById(merchantId, snapshot.id);
        const latest = current?.snapshot();
        const deletedWebhookWon = latest?.status === "failed" && latest.statusHistory.at(-1)?.reason === "PAYMENT_DELETED";
        if (latest?.status !== "cancelled" && !deletedWebhookWon) throw error;
      }
    }
  }
}
