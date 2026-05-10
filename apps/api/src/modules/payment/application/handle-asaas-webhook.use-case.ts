import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { CurrencyCode } from "@aacp/shared-types";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import type { CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CHECKOUT_PAYMENT_PORT } from "../domain/ports/checkout-payment.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";

export type AsaasWebhookInbound = {
  id: string;
  event: string;
  payment?: {
    id?: string;
    status?: string;
    value?: number;
    externalReference?: string;
  };
};

export type HandleAsaasWebhookResult =
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; effect: string };

function normalizeInbound(body: unknown): AsaasWebhookInbound {
  if (!body || typeof body !== "object") throw new BadRequestException("asaas_webhook_invalid_body");
  const o = body as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const event = typeof o.event === "string" ? o.event.trim() : "";
  const pay = o.payment;
  let payment: AsaasWebhookInbound["payment"];
  if (pay && typeof pay === "object" && !Array.isArray(pay)) {
    const p = pay as Record<string, unknown>;
    const rawVal = p.value;
    payment = {
      id: typeof p.id === "string" ? p.id : undefined,
      status: typeof p.status === "string" ? p.status : undefined,
      value:
        typeof rawVal === "number"
          ? rawVal
          : typeof rawVal === "string" && rawVal.trim() !== ""
            ? Number(rawVal)
            : undefined,
      externalReference: typeof p.externalReference === "string" ? p.externalReference.trim() : undefined
    };
  }
  return { id, event, payment };
}

export class UnauthorizedWebhookError extends Error {
  constructor() {
    super("asaas_webhook_token_invalid");
    this.name = "UnauthorizedWebhookError";
  }
}

export function assertWebhookToken(expectedToken: string | undefined, inboundHeader?: string): void {
  const expected = expectedToken?.trim();
  if (!expected) return;
  const got = inboundHeader?.trim() ?? "";
  if (got !== expected) throw new UnauthorizedWebhookError();
}

function majorUnitsFromCents(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

function paymentValueAsCents(paymentSlice: NonNullable<AsaasWebhookInbound["payment"]> | undefined): number | undefined {
  if (!paymentSlice || typeof paymentSlice.value !== "number" || Number.isNaN(paymentSlice.value)) return undefined;
  return Math.round(paymentSlice.value * 100);
}

@Injectable()
export class HandleAsaasWebhookUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment: CheckoutPaymentPort,
    @Optional() private readonly metrics?: MetricsService
  ) {}

  async execute(inboundAccessTokenHeader: string | undefined, rawBody: unknown): Promise<HandleAsaasWebhookResult> {
    assertWebhookToken(process.env.ASAAS_WEBHOOK_TOKEN, inboundAccessTokenHeader);

    const body = normalizeInbound(rawBody);

    if (!body.id || !body.event) {
      throw new BadRequestException("asaas_webhook_invalid_shape");
    }

    if (await this.payments.hasProcessedProviderEvent(body.id)) {
      return { outcome: "duplicate" };
    }

    const extRef = body.payment?.externalReference?.trim() ?? "";

    let intentEntity: PaymentIntentEntity | null = extRef ? await this.payments.getIntentById(extRef) : null;

    if (!intentEntity && extRef === "" && typeof body.payment?.id === "string" && body.payment.id.trim() !== "") {
      await this.payments.recordProcessedProviderEvent(body.id);
      return { outcome: "ignored", reason: "intent_lookup_requires_external_reference" };
    }

    if (!intentEntity) {
      await this.payments.recordProcessedProviderEvent(body.id);
      return { outcome: "ignored", reason: "intent_not_found" };
    }

    try {
      const effect = await this.dispatch(body.event, intentEntity.snapshot().id, body.payment);
      await this.payments.recordProcessedProviderEvent(body.id);
      return { outcome: "processed", effect };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      if (msg.includes("illegal_transition")) {
        await this.payments.recordProcessedProviderEvent(body.id);
        return { outcome: "ignored", reason: "illegal_transition_swallowed" };
      }
      throw e;
    }
  }

  private async dispatch(
    eventName: string,
    intentBusinessId: string,
    paymentSlice: NonNullable<AsaasWebhookInbound["payment"]> | undefined
  ): Promise<string> {
    const intentEntity = await this.payments.getIntentById(intentBusinessId);
    if (!intentEntity) return "intent_missing";

    switch (eventName) {
      case "PAYMENT_CREATED":
        return "noop_created";

      case "PAYMENT_RECEIVED":
        return await this.handlePaymentReceived(intentEntity, paymentSlice);

      case "PAYMENT_REFUNDED": {
        const snap = intentEntity.snapshot();
        if (snap.status === "approved") {
          intentEntity.markRefunded(eventName);
          await this.payments.saveIntent({ intent: intentEntity });
          await this.checkoutPayment.recordPaymentStatusChanged({
            merchantId: snap.merchantId,
            sessionId: snap.sessionId,
            paymentIntentId: snap.id,
            status: "refunded",
            reason: eventName
          });
        }
        return "payment_refunded";
      }

      case "PAYMENT_DELETED":
      case "PAYMENT_OVERDUE": {
        await this.failOpenIntent(intentEntity, eventName);
        return "payment_failed_fact";
      }

      default:
        return "ignored_event_type";
    }
  }

  private async handlePaymentReceived(
    intentEntity: PaymentIntentEntity,
    paymentSlice: NonNullable<AsaasWebhookInbound["payment"]> | undefined
  ): Promise<string> {
    const snap = intentEntity.snapshot();
    const payId = typeof paymentSlice?.id === "string" ? paymentSlice.id.trim() : "";
    const centsFromWebhook = paymentValueAsCents(paymentSlice);
    if (!payId) throw new BadRequestException("payment_id_missing_on_webhook");
    if (typeof centsFromWebhook !== "number") throw new BadRequestException("payment_value_missing_on_webhook");
    if (centsFromWebhook !== snap.amountCents) {
      intentEntity.markFailed("payment_value_mismatch");
      await this.payments.saveIntent({ intent: intentEntity });
      await this.checkoutPayment.recordPaymentStatusChanged({
        merchantId: snap.merchantId,
        sessionId: snap.sessionId,
        paymentIntentId: snap.id,
        status: "failed",
        reason: "payment_value_mismatch"
      });
      await this.checkoutPayment.recordPaymentFailure({
        merchantId: snap.merchantId,
        sessionId: snap.sessionId,
        reason: "payment_value_mismatch"
      });
      return "payment_value_mismatch";
    }

    if (snap.status === "approved") {
      return "already_approved";
    }

    intentEntity.markApproved({ providerPaymentId: payId, approvedAmountCents: snap.amountCents });
    await this.payments.saveIntent({ intent: intentEntity });
    await this.checkoutPayment.recordPaymentStatusChanged({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      paymentIntentId: snap.id,
      status: "approved"
    });

    this.metrics?.paymentApproved.inc({ merchant_id: snap.merchantId });
    await this.checkoutPayment.completeAfterApproval({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      externalOrderId: payId,
      orderTotalMajorUnits: majorUnitsFromCents(snap.amountCents),
      currency: snap.currency as CurrencyCode,
      acceptedOfferId: snap.acceptedOfferId
    });

    return "checkout_completed_after_payment";
  }

  private async failOpenIntent(intentEntity: PaymentIntentEntity, reason: string): Promise<void> {
    const snap = intentEntity.snapshot();
    if (snap.status === "approved") return;

    if (snap.status === "requires_action" || snap.status === "pending") {
      intentEntity.markFailed(reason);
      await this.payments.saveIntent({ intent: intentEntity });
      await this.checkoutPayment.recordPaymentStatusChanged({
        merchantId: snap.merchantId,
        sessionId: snap.sessionId,
        paymentIntentId: snap.id,
        status: "failed",
        reason
      });
      await this.checkoutPayment.recordPaymentFailure({
        merchantId: snap.merchantId,
        sessionId: snap.sessionId,
        reason
      });
    }
  }
}
