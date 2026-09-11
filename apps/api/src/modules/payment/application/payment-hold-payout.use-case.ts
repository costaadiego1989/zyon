import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import {
  PAYMENT_PAYOUT_PROVIDER,
  PayoutSubmissionError,
  type PaymentPayoutProviderPort,
} from "../domain/ports/payment-payout-provider.port.js";

type ReadyPaymentHold = {
  id: string;
  provider: string;
  payoutDestination: string;
  merchantNetCents: number;
};

const PAYOUT_BATCH_SIZE = 25;

function payoutReferenceFor(holdId: string): string {
  return `zyon:payment-hold:${holdId}`;
}

function failureCode(error: unknown): string {
  const code = error instanceof Error ? error.message.trim() : "payout_submission_unknown";
  return /^[a-z0-9_:-]{1,120}$/i.test(code) ? code : "payout_submission_unknown";
}

/**
 * Claims ready holds before contacting the provider. A claim is never retried
 * automatically after an ambiguous network outcome, because doing so could
 * duplicate a merchant transfer. Those rows stay `payout_submitted` for
 * reconciliation/operations review.
 */
@Injectable()
export class SubmitReadyPaymentHoldsUseCase {
  private readonly logger = new Logger(SubmitReadyPaymentHoldsUseCase.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(PAYMENT_PAYOUT_PROVIDER)
    private readonly payoutProvider?: PaymentPayoutProviderPort,
  ) {}

  async execute(now = new Date()): Promise<{
    claimed: number;
    submitted: number;
    failed: number;
    unresolved: number;
  }> {
    const holds = await (this.prisma as any).paymentHold.findMany({
      where: { status: "payout_ready", holdUntil: { lte: now } },
      orderBy: { holdUntil: "asc" },
      take: PAYOUT_BATCH_SIZE,
      select: {
        id: true,
        provider: true,
        payoutDestination: true,
        merchantNetCents: true,
      },
    }) as ReadyPaymentHold[];

    let claimed = 0;
    let submitted = 0;
    let failed = 0;
    let unresolved = 0;
    for (const hold of holds) {
      const result = await this.submitOne(hold, now);
      claimed += result.claimed ? 1 : 0;
      submitted += result.submitted ? 1 : 0;
      failed += result.failed ? 1 : 0;
      unresolved += result.unresolved ? 1 : 0;
    }
    return { claimed, submitted, failed, unresolved };
  }

  private async submitOne(hold: ReadyPaymentHold, now: Date): Promise<{
    claimed: boolean;
    submitted: boolean;
    failed: boolean;
    unresolved: boolean;
  }> {
    const payoutReference = payoutReferenceFor(hold.id);
    const claim = await (this.prisma as any).paymentHold.updateMany({
      where: { id: hold.id, status: "payout_ready" },
      data: {
        status: "payout_submitted",
        payoutReference,
        payoutAttemptedAt: now,
        failureCode: null,
      },
    });
    if ((claim.count ?? 0) !== 1) return { claimed: false, submitted: false, failed: false, unresolved: false };

    if (hold.provider !== "asaas" || !this.payoutProvider) {
      await this.markFailed(hold.id, payoutReference, "payment_hold_payout_provider_not_configured");
      return { claimed: true, submitted: false, failed: true, unresolved: false };
    }
    if (!Number.isSafeInteger(hold.merchantNetCents) || hold.merchantNetCents <= 0) {
      await this.markFailed(hold.id, payoutReference, "payment_hold_merchant_net_nonpositive");
      return { claimed: true, submitted: false, failed: true, unresolved: false };
    }

    try {
      const result = await this.payoutProvider.submitAsaasInternalPayout({
        payoutDestination: hold.payoutDestination,
        amountCents: hold.merchantNetCents,
        payoutReference,
      });
      if (result.state === "failed") {
        await (this.prisma as any).paymentHold.updateMany({
          where: { id: hold.id, status: "payout_submitted", payoutReference },
          data: {
            status: "payout_failed",
            payoutProviderTransferId: result.providerTransferId,
            failureCode: result.failureCode ?? "asaas_transfer_failed",
          },
        });
        return { claimed: true, submitted: false, failed: true, unresolved: false };
      }

      await (this.prisma as any).paymentHold.updateMany({
        where: { id: hold.id, status: "payout_submitted", payoutReference },
        data: { payoutProviderTransferId: result.providerTransferId, failureCode: null },
      });
      this.logger.log(`Asaas payout submitted for hold ${hold.id}; awaiting provider webhook`);
      return { claimed: true, submitted: true, failed: false, unresolved: false };
    } catch (error) {
      const code = failureCode(error);
      if (error instanceof PayoutSubmissionError && error.definitive) {
        await this.markFailed(hold.id, payoutReference, code);
        return { claimed: true, submitted: false, failed: true, unresolved: false };
      }
      await (this.prisma as any).paymentHold.updateMany({
        where: { id: hold.id, status: "payout_submitted", payoutReference },
        data: { failureCode: code },
      });
      this.logger.error(`Asaas payout submission is unresolved for hold ${hold.id}; automatic retry is blocked`);
      return { claimed: true, submitted: false, failed: false, unresolved: true };
    }
  }

  private async markFailed(holdId: string, payoutReference: string, code: string): Promise<void> {
    await (this.prisma as any).paymentHold.updateMany({
      where: { id: holdId, status: "payout_submitted", payoutReference },
      data: { status: "payout_failed", failureCode: code },
    });
  }
}
