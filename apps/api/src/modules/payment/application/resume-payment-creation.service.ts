import { BadGatewayException, ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PaymentIntentEntity, PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";

@Injectable()
export class ResumePaymentCreationService {
  private readonly logger = new Logger(ResumePaymentCreationService.name);
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
  ) {}

  async execute(intent: PaymentIntentEntity): Promise<PaymentIntentSnapshot> {
    const before = intent.snapshot();
    if (before.providerPaymentId && before.status === "requires_action" && before.method === "pix" &&
      !before.buyerFacing?.qrCodeCopyPaste?.trim() && before.creation) {
      // Repair old partial Pix records using only the provider's read/recovery
      // path. Bind to the already persisted payment before changing its payload.
      const result = await this.provider.recoverPayment?.(before.creation.input, before.creation.firstAttemptAt!)
        .catch(() => null);
      if (!result || result.providerPaymentId !== before.providerPaymentId || !result.buyerFacingPayload.qrCodeCopyPaste?.trim()) {
        throw new BadGatewayException("payment_creation_uncertain");
      }
      intent.setBuyerFacingPayload(result.buyerFacingPayload);
      try { await this.payments.saveIntent({ intent }); }
      catch (error) {
        if (error instanceof PaymentIntentConflictError) return this.latest(before);
        throw error;
      }
      return intent.snapshot();
    }
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
      if (before.method === "pix" && !result.buyerFacingPayload?.qrCodeCopyPaste?.trim()) {
        throw new Error("provider_pix_payload_unavailable");
      }
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
      // Never log the provider response body (payer data, QR payload or secrets).
      const code = error instanceof Error ? error.message.match(/^[a-z][a-z0-9_]*(?::\d{3})?(?=:|$)/)?.[0] : undefined;
      const providerCodes = error instanceof Error
        ? error.message.match(/^mercadopago_payment_create_failed:\d{3}:([a-zA-Z0-9_,\-]+)$/)?.[1]
        : undefined;
      this.logger.warn({ event: "payment_creation_failed", provider: creation.input.provider,
        method: before.method, action, code: code ?? "provider_request_failed", providerCodes });
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
