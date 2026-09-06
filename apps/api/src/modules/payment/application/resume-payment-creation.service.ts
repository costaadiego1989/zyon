import { BadGatewayException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PaymentIntentEntity, PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";

@Injectable()
export class ResumePaymentCreationService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
  ) {}

  async execute(intent: PaymentIntentEntity): Promise<PaymentIntentSnapshot> {
    const before = intent.snapshot();
    if (before.providerPaymentId || before.status !== "pending") return before;
    if (!before.creation) throw new ConflictException("payment_creation_manual_review_required");
    const leaseToken = randomUUID();
    const action = intent.claimCreation(leaseToken, new Date());
    if (!action) return before;
    try { await this.payments.saveIntent({ intent }); }
    catch (error) {
      if (error instanceof PaymentIntentConflictError) return this.latest(before);
      throw error;
    }

    const creation = intent.snapshot().creation!;
    try {
      const result = action === "create"
        ? await this.provider.createPayment(creation.input)
        : await this.provider.recoverPayment?.(creation.input, creation.firstAttemptAt!);
      if (!result) {
        intent.markCreationUncertain(leaseToken, "provider_result_not_found");
        await this.payments.saveIntent({ intent });
        return intent.snapshot();
      }
      if (!result.providerPaymentId?.trim()) throw new Error("provider_result_invalid");
      intent.completeCreation(leaseToken);
      intent.markRequiresAction({ providerPaymentId: result.providerPaymentId });
      intent.setBuyerFacingPayload(result.buyerFacingPayload ?? {});
      await this.payments.saveIntentWithOutbox({ intent }, createCheckoutEventEnvelope({
        eventType: "payment.status.changed", merchantId: before.merchantId,
        payload: { session_id: before.sessionId, payment_intent_id: before.id, status: intent.status, amount_cents: before.amountCents, method: before.method, commerce_order_id: before.commerceOrderId },
        causationId: before.id,
      }));
      return intent.snapshot();
    } catch (error) {
      if (error instanceof PaymentIntentConflictError) return this.latest(before);
      // Reload the persisted lease: in-memory completion may precede a failed commit.
      const current = await this.payments.getIntentById(before.merchantId, before.id);
      if (current?.snapshot().creation?.leaseToken === leaseToken) {
        current.markCreationUncertain(leaseToken, "provider_result_uncertain");
        try { await this.payments.saveIntent({ intent: current }); }
        catch (saveError) { if (!(saveError instanceof PaymentIntentConflictError)) throw saveError; }
      }
      throw new BadGatewayException("payment_creation_uncertain");
    }
  }

  private async latest(snapshot: PaymentIntentSnapshot): Promise<PaymentIntentSnapshot> {
    const current = await this.payments.getIntentById(snapshot.merchantId, snapshot.id);
    if (!current) throw new ConflictException("payment_creation_concurrent_change");
    return current.snapshot();
  }
}
