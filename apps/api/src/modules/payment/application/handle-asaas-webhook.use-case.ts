import { BadRequestException, Inject, Injectable, Optional , Logger} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type ProviderEventKey
} from "../domain/ports/payment-repository.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import {
  PAYMENT_SETTLEMENT_LEDGER,
  type ObservedPaymentSettlement,
  type PaymentSettlementLedgerPort,
} from "../domain/ports/payment-settlement-ledger.port.js";

export type AsaasWebhookInbound = {
  id: string;
  event: string;
  payment?: {
    id?: string;
    status?: string;
    value?: number;
    netValue?: number;
    externalReference?: string;
    split?: Array<{ id?: string; fixedValue?: number }>;
  };
  additionalInfo?: { splitId?: string };
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
    const rawNetValue = p.netValue;
    const rawSplit = p.split;
    const split = Array.isArray(rawSplit)
      ? rawSplit.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const candidate = item as Record<string, unknown>;
        const fixedValue = candidate.fixedValue;
        return [{
          id: typeof candidate.id === "string" ? candidate.id.trim() || undefined : undefined,
          fixedValue: typeof fixedValue === "number"
            ? fixedValue
            : typeof fixedValue === "string" && fixedValue.trim() !== "" ? Number(fixedValue) : undefined,
        }];
      })
      : undefined;
    payment = {
      id: typeof p.id === "string" ? p.id : undefined,
      status: typeof p.status === "string" ? p.status : undefined,
      value:
        typeof rawVal === "number"
          ? rawVal
          : typeof rawVal === "string" && rawVal.trim() !== ""
            ? Number(rawVal)
            : undefined,
      netValue:
        typeof rawNetValue === "number"
          ? rawNetValue
          : typeof rawNetValue === "string" && rawNetValue.trim() !== ""
            ? Number(rawNetValue)
            : undefined,
      externalReference: typeof p.externalReference === "string" ? p.externalReference.trim() : undefined,
      split,
    };
  }
  const additionalInfo = o.additionalInfo;
  const additionalInfoRecord = additionalInfo && typeof additionalInfo === "object" && !Array.isArray(additionalInfo)
    ? additionalInfo as Record<string, unknown>
    : undefined;
  const rawSplitId = additionalInfoRecord?.splitId;
  const splitId = typeof rawSplitId === "string" ? rawSplitId.trim() || undefined : undefined;
  return { id, event, payment, additionalInfo: splitId ? { splitId } : undefined };
}

export class UnauthorizedWebhookError extends Error {
  private readonly logger = new Logger(UnauthorizedWebhookError.name);

  constructor() {
    super("asaas_webhook_token_invalid");
    this.name = "UnauthorizedWebhookError";
  }
}

export function assertWebhookToken(expectedToken: string | undefined, inboundHeader?: string): void {
  const expected = expectedToken?.trim();
  // FAIL-CLOSED: if no webhook token is configured, reject all incoming webhooks.
  if (!expected) throw new UnauthorizedWebhookError();
  const got = inboundHeader?.trim() ?? "";
  // M5 fix: constant-time comparison to prevent timing oracle
  if (got.length !== expected.length) throw new UnauthorizedWebhookError();
  const equal = timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(expected, "utf8"));
  if (!equal) throw new UnauthorizedWebhookError();
}

function majorUnitsFromCents(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

function paymentValueAsCents(paymentSlice: NonNullable<AsaasWebhookInbound["payment"]> | undefined): number | undefined {
  if (!paymentSlice || typeof paymentSlice.value !== "number" || !Number.isFinite(paymentSlice.value)) return undefined;
  return Math.round(paymentSlice.value * 100);
}

function paymentNetValueAsCents(paymentSlice: NonNullable<AsaasWebhookInbound["payment"]> | undefined): number | undefined {
  if (!paymentSlice || typeof paymentSlice.netValue !== "number" || !Number.isFinite(paymentSlice.netValue)) return undefined;
  return Math.round(paymentSlice.netValue * 100);
}

@Injectable()
export class HandleAsaasWebhookUseCase {
  private readonly logger = new Logger(HandleAsaasWebhookUseCase.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly paymentDispatch: PaymentDispatchService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
    @Optional() @Inject(PAYMENT_SETTLEMENT_LEDGER) private readonly settlementLedger?: PaymentSettlementLedgerPort,
  ) {}

  async execute(inboundAccessTokenHeader: string | undefined, rawBody: unknown, webhookToken?: string): Promise<HandleAsaasWebhookResult> {
    const expectedToken = webhookToken ?? process.env.ASAAS_WEBHOOK_TOKEN;
    assertWebhookToken(expectedToken, inboundAccessTokenHeader);

    const body = normalizeInbound(rawBody);
    const correlationId = CorrelationIdStorage.get() ?? "none";
    this.logger.log(`asaas.webhook.received event=${body.event} correlation=${correlationId}`);

    if (!body.id || !body.event) {
      throw new BadRequestException("asaas_webhook_invalid_shape");
    }

    const extRef = body.payment?.externalReference?.trim() ?? "";

    // Resolve the tenant from the external reference WITHOUT trusting it as a
    // scoped read: the port returns only { id, merchantId }; the authoritative
    // entity is re-fetched scoped below (ADR 0001 #3).
    const ref = extRef ? await this.payments.getIntentByExternalReference(extRef) : null;
    const merchantId = ref?.merchantId ?? null;
    const eventKey: ProviderEventKey = { provider: "asaas", merchantId, eventId: body.id };

    // Atomic idempotency gate: record the marker BEFORE any side effect. A
    // losing concurrent delivery gets `false` and short-circuits — never runs
    // dispatch twice (ADR 0001 #1).
    const reserved = await this.payments.recordProcessedProviderEvent(eventKey);
    if (!reserved) {
      return { outcome: "duplicate" };
    }

    if (!ref && extRef === "" && typeof body.payment?.id === "string" && body.payment.id.trim() !== "") {
      return { outcome: "ignored", reason: "intent_lookup_requires_external_reference" };
    }

    if (!ref) {
      this.logger.warn(`asaas.webhook.ignored reason=intent_not_found correlation=${correlationId}`);
      return { outcome: "ignored", reason: "intent_not_found" };
    }

    const intentEntity = await this.payments.getIntentById(ref.merchantId, ref.id);
    if (!intentEntity) {
      this.logger.warn(`asaas.webhook.ignored reason=intent_not_found correlation=${correlationId}`);
      return { outcome: "ignored", reason: "intent_not_found" };
    }
    try {
      const effect = await this.dispatch(body, intentEntity);
      return { outcome: "processed", effect };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      if (msg.includes("illegal_transition")) {
        // Genuine illegal transition (out-of-order delivery / state corruption),
        // NOT a benign idempotent re-delivery (those return early without
        // throwing). Do not swallow silently: emit metric + structured log and
        // keep the marker consumed to avoid a poison re-delivery loop. The
        // anomaly is surfaced for dead-letter/alert review (ADR 0001 #4).
        this.metrics?.paymentWebhookAnomaly.inc({ provider: "asaas", kind: "illegal_transition" });
        this.logger.error("asaas.webhook.illegal_transition", {
          event: body.event,
          correlationId,
        });
        return { outcome: "ignored", reason: "illegal_transition_alerted" };
      }
      // Transient failure mid-dispatch: release the idempotency marker so the
      // provider's re-delivery can retry the whole effect (ADR 0001 #1).
      await this.payments.deleteProcessedProviderEvent(eventKey);
      throw e;
    }
  }

  private async dispatch(
    inbound: AsaasWebhookInbound,
    intentEntity: PaymentIntentEntity,
  ): Promise<string> {
    switch (inbound.event) {
      case "PAYMENT_CREATED":
        return "noop_created";

      case "PAYMENT_RECEIVED":
      case "PAYMENT_CONFIRMED":
        return await this.handlePaymentReceived(intentEntity, inbound.payment);

      case "PAYMENT_SPLIT_DONE":
        return await this.recordSplitObservation("confirmed", inbound, intentEntity);

      case "PAYMENT_SPLIT_DIVERGENCE_BLOCK":
      case "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED":
        return await this.recordSplitObservation("blocked", inbound, intentEntity);

      case "PAYMENT_REFUNDED": {
        await this.paymentDispatch.markRefunded(intentEntity, inbound.event);
        return "payment_refunded";
      }

      case "PAYMENT_DELETED":
      case "PAYMENT_OVERDUE": {
        await this.failOpenIntent(intentEntity, inbound.event);
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

    if (snap.status !== "approved" && centsFromWebhook !== snap.amountCents) {
      this.metrics?.paymentWebhookAnomaly.inc({ provider: "asaas", kind: "value_mismatch" });
      await this.paymentDispatch.markFailed(intentEntity, "payment_value_mismatch");
      return "payment_value_mismatch";
    }

    const result = await this.paymentDispatch.markApprovedAndComplete(intentEntity, payId);

    // Create in-app notification for merchant (fire-and-forget)
    try {
      if (this.prisma) {
        const merchantId = snap.merchantId;
        await this.prisma.merchantNotification.create({
          data: {
            merchantId,
            type: "order_paid",
            title: `Novo pedido pago! R$ ${(snap.amountCents / 100).toFixed(2)}`,
            body: `Pagamento confirmado via ${snap.method ?? "PIX"}`,
            metadata: { intentId: snap.id, amountCents: snap.amountCents, method: snap.method },
          },
        });
      }
    } catch {
      // Non-blocking — notification creation must never fail the webhook
    }

    return result;
  }

  private async recordSplitObservation(
    status: "confirmed" | "blocked",
    inbound: AsaasWebhookInbound,
    intentEntity: PaymentIntentEntity,
  ): Promise<string> {
    if (!this.settlementLedger) return "settlement_ledger_unavailable";
    const snapshot = intentEntity.snapshot();
    const providerPaymentId = inbound.payment?.id?.trim() ?? "";
    if (!providerPaymentId || !snapshot.providerPaymentId || providerPaymentId !== snapshot.providerPaymentId) {
      this.metrics?.paymentWebhookAnomaly.inc({ provider: "asaas", kind: "split_payment_reference_mismatch" });
      this.logger.warn(`asaas.webhook.ignored reason=split_payment_reference_mismatch correlation=${CorrelationIdStorage.get() ?? "none"}`);
      return "split_payment_reference_mismatch";
    }
    const settlements = await this.settlementLedger.listForPaymentIntent(snapshot.merchantId, snapshot.id);
    const plan = settlements.find(item => item.sequence === 1 && item.status === "planned");
    if (!plan) {
      this.logger.warn(`asaas.webhook.ignored reason=settlement_plan_missing correlation=${CorrelationIdStorage.get() ?? "none"}`);
      return "settlement_plan_missing";
    }
    const splitId = inbound.additionalInfo?.splitId;
    const split = splitId ? inbound.payment?.split?.find(item => item.id === splitId) : undefined;
    const fixedValueCents = split && typeof split.fixedValue === "number" && Number.isFinite(split.fixedValue)
      ? Math.round(split.fixedValue * 100)
      : undefined;
    const plannedPlatformEntry = plan.entries.find(entry => entry.entryKey === "platform_fee");
    const plannedMerchantEntry = plan.entries.find(entry => entry.entryKey === "merchant_payout");
    const isExpectedPlatformSplit = fixedValueCents !== undefined && plannedPlatformEntry !== undefined &&
      fixedValueCents === plannedPlatformEntry.plannedAmountCents;
    const grossValueCents = paymentValueAsCents(inbound.payment);
    const netValueCents = paymentNetValueAsCents(inbound.payment);
    // `netValue` is the provider's amount after its own fee. It lets the
    // ledger distinguish an observed issuer balance from the planned merchant
    // allocation, without presenting it as a bank payout.
    const hasObservedNetValue = grossValueCents === plan.plannedGrossCents &&
      netValueCents !== undefined && netValueCents >= 0 && netValueCents <= grossValueCents;
    const confirmedMerchantNetCents = hasObservedNetValue && isExpectedPlatformSplit && plannedMerchantEntry &&
      netValueCents >= fixedValueCents
      ? netValueCents - fixedValueCents
      : undefined;
    const settledAt = new Date();
    const observation: ObservedPaymentSettlement = {
      merchantId: snapshot.merchantId,
      paymentIntentId: snapshot.id,
      provider: "asaas",
      status,
      currency: snapshot.currency,
      providerPaymentId,
      providerSettlementId: splitId ? `asaas:split:${splitId}` : `asaas:webhook:${inbound.id}`,
      providerReference: inbound.event,
      ...(status === "confirmed" ? {
        confirmedGrossCents: hasObservedNetValue ? grossValueCents : undefined,
        confirmedPlatformFeeCents: isExpectedPlatformSplit ? fixedValueCents : undefined,
        confirmedMerchantNetCents,
        confirmedProviderFeeCents: hasObservedNetValue ? grossValueCents - netValueCents : undefined,
        confirmedAt: settledAt,
        entries: [
          ...(isExpectedPlatformSplit
            ? [{ entryKey: "platform_fee" as const, confirmedAmountCents: fixedValueCents, providerTransferId: splitId }]
            : []),
          ...(confirmedMerchantNetCents !== undefined
            ? [{ entryKey: "merchant_payout" as const, confirmedAmountCents: confirmedMerchantNetCents }]
            : []),
        ],
      } : { entries: [] }),
      occurredAt: settledAt,
    };
    await this.settlementLedger.appendObservation(observation);
    if (status === "blocked") return inbound.event === "PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED"
      ? "split_divergence_block_finished_recorded"
      : "split_divergence_block_recorded";
    return isExpectedPlatformSplit
      ? "split_settlement_recorded"
      : "split_settlement_recorded_without_allocation";
  }

  private async failOpenIntent(intentEntity: PaymentIntentEntity, reason: string): Promise<void> {
    await this.paymentDispatch.markFailed(intentEntity, reason);
  }
}
