import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type ProviderEventKey,
} from "../domain/ports/payment-repository.port.js";
import {
  PAYMENT_SETTLEMENT_LEDGER,
  type PaymentSettlementLedgerPort,
} from "../domain/ports/payment-settlement-ledger.port.js";
import { assertWebhookToken } from "./handle-asaas-webhook.use-case.js";

type AsaasTransfer = {
  id: string;
  status?: string;
  value?: number;
  externalReference: string;
  failReason?: string;
};

type AsaasTransferWebhook = {
  id: string;
  event: string;
  transfer: AsaasTransfer;
};

type PaymentHoldForTransfer = {
  id: string;
  merchantId: string;
  paymentIntentId: string;
  provider: string;
  providerPaymentId: string | null;
  merchantNetCents: number;
  payoutReference: string | null;
  payoutProviderTransferId: string | null;
  status: string;
};

export type HandleAsaasTransferWebhookResult =
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "processed"; effect: string };

export function isAsaasTransferWebhook(rawBody: unknown): boolean {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return false;
  const event = (rawBody as { event?: unknown }).event;
  return typeof event === "string" && event.trim().startsWith("TRANSFER_");
}

function parseTransferWebhook(rawBody: unknown): AsaasTransferWebhook {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new BadRequestException("asaas_transfer_webhook_invalid_body");
  }
  const body = rawBody as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const event = typeof body.event === "string" ? body.event.trim() : "";
  const rawTransfer = body.transfer;
  if (!id || !event || !rawTransfer || typeof rawTransfer !== "object" || Array.isArray(rawTransfer)) {
    throw new BadRequestException("asaas_transfer_webhook_invalid_shape");
  }
  const transfer = rawTransfer as Record<string, unknown>;
  const transferId = typeof transfer.id === "string" ? transfer.id.trim() : "";
  const externalReference = typeof transfer.externalReference === "string" ? transfer.externalReference.trim() : "";
  const rawValue = transfer.value;
  const value = typeof rawValue === "number"
    ? rawValue
    : typeof rawValue === "string" && rawValue.trim() ? Number(rawValue) : undefined;
  if (!transferId || !externalReference || (value !== undefined && !Number.isFinite(value))) {
    throw new BadRequestException("asaas_transfer_webhook_invalid_transfer");
  }
  return {
    id,
    event,
    transfer: {
      id: transferId,
      externalReference,
      value,
      status: typeof transfer.status === "string" ? transfer.status.trim() || undefined : undefined,
      failReason: typeof transfer.failReason === "string" ? transfer.failReason.trim() || undefined : undefined,
    },
  };
}

function centsFromMajor(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 100);
}

function safeFailureCode(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && /^[a-z0-9_:-]{1,120}$/i.test(normalized) ? normalized : fallback;
}

/**
 * Reconciles platform-account transfer webhooks. The transfer reference is
 * generated only after an atomic claim of a payout-ready hold, and the amount
 * and provider transfer id are checked before any financial state transition.
 */
@Injectable()
export class HandleAsaasTransferWebhookUseCase {
  private readonly logger = new Logger(HandleAsaasTransferWebhookUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Optional() @Inject(PAYMENT_SETTLEMENT_LEDGER)
    private readonly settlementLedger?: PaymentSettlementLedgerPort,
  ) {}

  async execute(
    inboundAccessTokenHeader: string | undefined,
    rawBody: unknown,
    webhookToken?: string,
  ): Promise<HandleAsaasTransferWebhookResult> {
    assertWebhookToken(webhookToken ?? process.env.ASAAS_WEBHOOK_TOKEN, inboundAccessTokenHeader);
    const inbound = parseTransferWebhook(rawBody);
    const hold = await (this.prisma as any).paymentHold.findFirst({
      where: { payoutReference: inbound.transfer.externalReference },
    }) as PaymentHoldForTransfer | null;
    if (!hold || hold.provider !== "asaas") return { outcome: "ignored", reason: "payout_hold_not_found" };
    if (centsFromMajor(inbound.transfer.value) !== undefined && centsFromMajor(inbound.transfer.value) !== hold.merchantNetCents) {
      this.logger.error(`Asaas payout ${inbound.transfer.id} has an amount mismatch for hold ${hold.id}`);
      return { outcome: "ignored", reason: "payout_transfer_amount_mismatch" };
    }
    if (hold.payoutProviderTransferId && hold.payoutProviderTransferId !== inbound.transfer.id) {
      this.logger.error(`Asaas payout ${inbound.transfer.id} does not match the stored transfer for hold ${hold.id}`);
      return { outcome: "ignored", reason: "payout_transfer_identity_mismatch" };
    }

    const eventKey: ProviderEventKey = { provider: "asaas", merchantId: hold.merchantId, eventId: inbound.id };
    const reserved = await this.payments.recordProcessedProviderEvent(eventKey);
    if (!reserved) return { outcome: "duplicate" };
    try {
      const effect = await this.dispatch(inbound, hold);
      return { outcome: "processed", effect };
    } catch (error) {
      // The PSP delivers at least once. Releasing the marker lets a later
      // delivery reconcile an otherwise durable provider fact.
      await this.payments.deleteProcessedProviderEvent(eventKey);
      throw error;
    }
  }

  private async dispatch(inbound: AsaasTransferWebhook, hold: PaymentHoldForTransfer): Promise<string> {
    const transferId = inbound.transfer.id;
    const commonWhere = {
      id: hold.id,
      provider: "asaas",
      payoutReference: inbound.transfer.externalReference,
      OR: [
        { payoutProviderTransferId: null },
        { payoutProviderTransferId: transferId },
      ],
    };
    const now = new Date();

    switch (inbound.event) {
      case "TRANSFER_CREATED":
      case "TRANSFER_PENDING":
      case "TRANSFER_IN_BANK_PROCESSING": {
        const result = await (this.prisma as any).paymentHold.updateMany({
          where: { ...commonWhere, status: "payout_submitted" },
          data: { payoutProviderTransferId: transferId, failureCode: null },
        });
        return (result.count ?? 0) === 1 ? "payout_transfer_pending" : "payout_transfer_state_unchanged";
      }

      case "TRANSFER_BLOCKED": {
        const result = await (this.prisma as any).paymentHold.updateMany({
          where: { ...commonWhere, status: "payout_submitted" },
          data: { payoutProviderTransferId: transferId, failureCode: "asaas_transfer_blocked" },
        });
        return (result.count ?? 0) === 1 ? "payout_transfer_blocked" : "payout_transfer_state_unchanged";
      }

      case "TRANSFER_FAILED":
      case "TRANSFER_CANCELLED": {
        const result = await (this.prisma as any).paymentHold.updateMany({
          where: { ...commonWhere, status: "payout_submitted" },
          data: {
            status: "payout_failed",
            payoutProviderTransferId: transferId,
            failureCode: safeFailureCode(inbound.transfer.failReason, `asaas_${inbound.event.toLowerCase()}`),
          },
        });
        return (result.count ?? 0) === 1 ? "payout_transfer_failed" : "payout_transfer_state_unchanged";
      }

      case "TRANSFER_DONE": {
        const recoveryStatuses = ["refund_reversal_required", "chargeback_debt"];
        const recoveryUpdate = await (this.prisma as any).paymentHold.updateMany({
          where: { ...commonWhere, status: { in: recoveryStatuses } },
          data: {
            payoutProviderTransferId: transferId,
            payoutConfirmedAt: now,
            failureCode: null,
          },
        });
        const releaseUpdate = (recoveryUpdate.count ?? 0) === 0
          ? await (this.prisma as any).paymentHold.updateMany({
              where: { ...commonWhere, status: { in: ["payout_submitted", "released"] } },
              data: {
                status: "released",
                payoutProviderTransferId: transferId,
                payoutConfirmedAt: now,
                releasedAt: now,
                failureCode: null,
              },
            })
          : { count: 1 };
        if ((releaseUpdate.count ?? 0) === 0) return "payout_transfer_state_unchanged";

        await this.settlementLedger?.appendObservation({
          merchantId: hold.merchantId,
          paymentIntentId: hold.paymentIntentId,
          provider: "asaas",
          status: "confirmed",
          currency: "BRL",
          providerSettlementId: `asaas:transfer:${transferId}`,
          providerPaymentId: hold.providerPaymentId ?? undefined,
          providerReference: inbound.transfer.externalReference,
          confirmedMerchantNetCents: hold.merchantNetCents,
          occurredAt: now,
          confirmedAt: now,
          entries: [{
            entryKey: "merchant_payout",
            confirmedAmountCents: hold.merchantNetCents,
            providerTransferId: transferId,
            providerReference: inbound.transfer.externalReference,
          }],
        });
        return (recoveryUpdate.count ?? 0) === 1 ? "payout_transfer_done_reversal_required" : "payout_transfer_released";
      }

      default:
        return "payout_transfer_event_ignored";
    }
  }
}
