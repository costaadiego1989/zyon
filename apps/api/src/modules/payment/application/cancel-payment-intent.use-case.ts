import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CHECKOUT_REPOSITORY, type CheckoutRepository } from "../../checkout/domain/ports/checkout-repository.port.js";
import type { TrustedCheckoutBuyer } from "../../checkout/application/services/trusted-checkout-buyer.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import type { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type { PaymentCancellation, PendingPaymentCancellationInput, PendingPaymentCancellationResult } from "../domain/pending-payment-cancellation.js";
import { savePaymentTransition } from "./services/save-payment-transition.js";

export type CancelPaymentIntentRequest = { merchantId: string; sessionId: string; intentId: string; idempotencyKey: string; buyer: TrustedCheckoutBuyer };
export type CancelPaymentIntentResponse = { version: 1; intent_id: string; status: string; cancellation: "cancelled" | "pending" | "unsupported" | "not_pending"; reason?: string };

/** A cancellation is a durable single submission. Recovery only reads the original charge. */
@Injectable()
export class CancelPaymentIntentUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(CHECKOUT_REPOSITORY) private readonly checkout: CheckoutRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
  ) {}

  async execute(input: CancelPaymentIntentRequest): Promise<CancelPaymentIntentResponse> {
    if (![input.merchantId, input.sessionId, input.intentId, input.idempotencyKey].every(v => typeof v === "string" && /^[A-Za-z0-9_:-]{1,200}$/.test(v))) {
      throw new BadRequestException("payment_cancellation_fields_invalid");
    }
    const session = await this.checkout.getSession(input.merchantId, input.sessionId);
    if (!session || session.merchantId !== input.merchantId || session.sessionId !== input.sessionId ||
        !input.buyer?.globalUserId || session.globalUserId !== input.buyer.globalUserId) throw new ForbiddenException("payment_cancellation_buyer_mismatch");
    let intent = await this.load(input);
    const snapshot = intent.snapshot();
    const sessionScope = session as { crossStoreItems?: unknown[] };
    const paymentScope = snapshot.creation?.input as { marketplaceFunding?: unknown; marketplacePublicAdmission?: unknown } | undefined;
    if (sessionScope.crossStoreItems?.length || session.cart.items.some(line => (line as { marketplace?: unknown }).marketplace !== undefined) || (session.shipping as { marketplace?: unknown } | undefined)?.marketplace !== undefined ||
        paymentScope?.marketplaceFunding !== undefined || paymentScope?.marketplacePublicAdmission !== undefined) {
      return this.reply(intent, "unsupported", "payment_cancellation_unsupported");
    }
    if (!["pending", "requires_action"].includes(snapshot.status)) return this.reply(intent, snapshot.status === "cancelled" ? "cancelled" : "not_pending", "payment_not_pending");
    const creation = snapshot.creation, original = creation?.input;
    if (!creation || creation.state !== "complete" || !original?.provider || !original.providerAccountFingerprint || !snapshot.providerPaymentId ||
        original.intentId !== snapshot.id || original.merchantId !== snapshot.merchantId || original.sessionId !== snapshot.sessionId ||
        original.amountCents !== snapshot.amountCents || original.currency !== snapshot.currency || original.method !== snapshot.method ||
        !this.provider.readCancellationStatus || !this.provider.cancelPendingPayment) return this.reply(intent, "unsupported", "payment_cancellation_unsupported");

    const previous = creation.cancellation;
    if (previous && (previous.buyerId !== input.buyer.globalUserId || previous.providerPaymentId !== snapshot.providerPaymentId)) throw new ForbiddenException("payment_cancellation_buyer_mismatch");
    if (previous?.state === "blocked") return this.reply(intent, previous.reason === "payment_cancellation_unsupported" ? "unsupported" : "not_pending", previous.reason);
    if (previous?.leaseUntil && Date.parse(previous.leaseUntil) > Date.now()) return this.reply(intent, "pending", "payment_cancellation_in_progress");
    const token = randomUUID(), now = new Date().toISOString();
    const operation: PaymentCancellation = { ...previous, operationId: previous?.operationId ?? `cancel_${snapshot.id}`,
      buyerId: input.buyer.globalUserId, idempotencyKey: previous?.idempotencyKey ?? input.idempotencyKey,
      providerPaymentId: snapshot.providerPaymentId, startedAt: previous?.startedAt ?? now,
      state: "in_flight", leaseToken: token, leaseUntil: new Date(Date.now() + 120_000).toISOString() };
    intent.recordCancellation(operation);
    try { await this.payments.saveIntent({ intent }); }
    catch (error) { if (!(error instanceof PaymentIntentConflictError)) throw error; return this.reply(await this.load(input), "pending", "payment_cancellation_in_progress"); }
    const providerInput: PendingPaymentCancellationInput = { payment: original, providerPaymentId: snapshot.providerPaymentId, idempotencyKey: operation.operationId };
    let result: PendingPaymentCancellationResult;
    try { result = await this.provider.readCancellationStatus(providerInput); }
    catch { result = { state: "unknown" }; }
    if (result.state === "pending" && !operation.mutationAttemptedAt) {
      // Reload after PSP read so a concurrently approved webhook wins BEFORE any mutation.
      intent = await this.load(input);
      const current = intent.snapshot();
      if (!["pending", "requires_action"].includes(current.status)) return this.reply(intent, current.status === "cancelled" ? "cancelled" : "not_pending", "payment_not_pending");
      if (current.creation?.cancellation?.leaseToken !== token) return this.reply(intent, "pending", "payment_cancellation_in_progress");
      intent.recordCancellation({ ...operation, mutationAttemptedAt: new Date().toISOString() });
      try { await this.payments.saveIntent({ intent }); }
      catch (error) { if (!(error instanceof PaymentIntentConflictError)) throw error; return this.reply(await this.load(input), "pending", "payment_cancellation_in_progress"); }
      try { result = await this.provider.cancelPendingPayment(providerInput); }
      catch { result = { state: "unknown" }; }
    }
    return this.finish(input, token, result);
  }

  private async load(input: Pick<CancelPaymentIntentRequest, "merchantId" | "sessionId" | "intentId">): Promise<PaymentIntentEntity> {
    const intent = await this.payments.getIntentById(input.merchantId, input.intentId);
    const s = intent?.snapshot();
    if (!intent || s?.merchantId !== input.merchantId || s.sessionId !== input.sessionId || s.id !== input.intentId) throw new NotFoundException("payment_intent_not_found");
    return intent;
  }

  private async finish(input: CancelPaymentIntentRequest, token: string, result: PendingPaymentCancellationResult): Promise<CancelPaymentIntentResponse> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const intent = await this.load(input), snapshot = intent.snapshot(), operation = snapshot.creation?.cancellation;
      if (snapshot.status === "cancelled") return this.reply(intent, "cancelled");
      if (!["pending", "requires_action"].includes(snapshot.status)) return this.reply(intent, "not_pending", "payment_not_pending");
      if (!operation || operation.leaseToken !== token) return this.reply(intent, "pending", "payment_cancellation_in_progress");
      const cancelled = result.state === "cancelled", blocked = ["paid", "unavailable", "unsupported"].includes(result.state);
      const reason = cancelled ? undefined : result.state === "unsupported" ? "payment_cancellation_unsupported" :
        blocked ? "payment_not_pending" : "payment_cancellation_unconfirmed";
      intent.recordCancellation({ ...operation, state: cancelled ? "cancelled" : blocked ? "blocked" : "uncertain", leaseToken: undefined, leaseUntil: undefined, reason });
      if (cancelled) intent.markCancelled("buyer_requested_provider_cancellation");
      try {
        if (cancelled) await savePaymentTransition(this.payments, intent, "buyer_requested_provider_cancellation");
        else await this.payments.saveIntent({ intent });
        return this.reply(intent, cancelled ? "cancelled" : result.state === "unsupported" ? "unsupported" : blocked ? "not_pending" : "pending", reason);
      } catch (error) { if (!(error instanceof PaymentIntentConflictError)) throw error; }
    }
    return this.reply(await this.load(input), "pending", "payment_cancellation_in_progress");
  }

  private reply(intent: PaymentIntentEntity, cancellation: CancelPaymentIntentResponse["cancellation"], reason?: string): CancelPaymentIntentResponse {
    const snapshot = intent.snapshot();
    // A concurrent approval is never projected as a successful cancellation.
    if (!["pending", "requires_action", "cancelled"].includes(snapshot.status)) cancellation = "not_pending";
    return { version: 1, intent_id: snapshot.id, status: snapshot.status, cancellation, ...(reason ? { reason } : {}) };
  }
}
