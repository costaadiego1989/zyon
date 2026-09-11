import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";

export const DEFAULT_PAYMENT_HOLD_DAYS = 14;

export type PaymentHoldProvider = "asaas" | "stripe";
export type PaymentHoldStatus =
  | "held"
  | "payout_ready"
  | "payout_submitted"
  | "released"
  | "payout_failed"
  | "refunded"
  | "refund_reversal_required"
  | "chargebacked"
  | "chargeback_debt";

export type CreatePaymentHoldInput = {
  merchantId: string;
  paymentIntentId: string;
  orderId?: string;
  provider: PaymentHoldProvider;
  providerPaymentId: string;
  payoutDestination: string;
  totalAmountCents: number;
  platformFeeCents: number;
  holdDays?: number;
};

type PaymentHoldRecord = {
  id: string;
  merchantId: string;
  paymentIntentId: string;
  provider: string;
  providerPaymentId: string | null;
  payoutDestination: string;
  totalAmountCents: number;
  platformFeeCents: number;
  merchantNetCents: number;
  holdUntil: Date;
};

function nonEmpty(value: string | undefined, error: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(error);
  return normalized;
}

function nonNegativeCents(value: number, error: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(error);
  return value;
}

function holdUntilFrom(now: Date, holdDays: number): Date {
  if (!Number.isSafeInteger(holdDays) || holdDays < 1 || holdDays > 90) {
    throw new Error("payment_hold_window_invalid");
  }
  return new Date(now.getTime() + holdDays * 86_400_000);
}

function assertSameImmutableHold(existing: PaymentHoldRecord, expected: Omit<PaymentHoldRecord, "id" | "holdUntil">): void {
  if (
    existing.merchantId !== expected.merchantId ||
    existing.paymentIntentId !== expected.paymentIntentId ||
    existing.provider !== expected.provider ||
    existing.providerPaymentId !== expected.providerPaymentId ||
    existing.payoutDestination !== expected.payoutDestination ||
    existing.totalAmountCents !== expected.totalAmountCents ||
    existing.platformFeeCents !== expected.platformFeeCents ||
    existing.merchantNetCents !== expected.merchantNetCents
  ) {
    throw new Error("payment_hold_identity_conflict");
  }
}

/** Creates an idempotent operational hold after platform-owned payment approval. */
@Injectable()
export class CreatePaymentHoldUseCase {
  private readonly logger = new Logger(CreatePaymentHoldUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(input: CreatePaymentHoldInput): Promise<{
    holdId: string;
    holdUntil: Date;
    platformFeeCents: number;
    merchantNetCents: number;
  }> {
    const merchantId = nonEmpty(input.merchantId, "payment_hold_merchant_required");
    const paymentIntentId = nonEmpty(input.paymentIntentId, "payment_hold_intent_required");
    const providerPaymentId = nonEmpty(input.providerPaymentId, "payment_hold_provider_payment_required");
    const payoutDestination = nonEmpty(input.payoutDestination, "payment_hold_payout_destination_required");
    if (input.provider !== "asaas" && input.provider !== "stripe") throw new Error("payment_hold_provider_unsupported");

    const totalAmountCents = nonNegativeCents(input.totalAmountCents, "payment_hold_total_invalid");
    const platformFeeCents = nonNegativeCents(input.platformFeeCents, "payment_hold_platform_fee_invalid");
    const merchantNetCents = totalAmountCents - platformFeeCents;
    if (merchantNetCents < 0) throw new Error("payment_hold_net_invalid");

    const expected = {
      merchantId,
      paymentIntentId,
      provider: input.provider,
      providerPaymentId,
      payoutDestination,
      totalAmountCents,
      platformFeeCents,
      merchantNetCents,
    };
    const existing = await (this.prisma as any).paymentHold.findUnique({ where: { paymentIntentId } }) as PaymentHoldRecord | null;
    if (existing) {
      assertSameImmutableHold(existing, expected);
      return { holdId: existing.id, holdUntil: existing.holdUntil, platformFeeCents: existing.platformFeeCents, merchantNetCents: existing.merchantNetCents };
    }

    const holdUntil = holdUntilFrom(new Date(), input.holdDays ?? DEFAULT_PAYMENT_HOLD_DAYS);
    try {
      const hold = await (this.prisma as any).paymentHold.create({
        data: { ...expected, orderId: input.orderId?.trim() || null, status: "held", holdUntil },
      }) as PaymentHoldRecord;
      this.logger.log(`Payment hold ${hold.id} created for merchant ${merchantId}; eligible at ${holdUntil.toISOString()}`);
      return { holdId: hold.id, holdUntil, platformFeeCents, merchantNetCents };
    } catch (error) {
      // Concurrent webhook deliveries may race on the unique intent id. Only an
      // exact immutable match is a safe idempotent success.
      const concurrent = await (this.prisma as any).paymentHold.findUnique({ where: { paymentIntentId } }) as PaymentHoldRecord | null;
      if (!concurrent) throw error;
      assertSameImmutableHold(concurrent, expected);
      return { holdId: concurrent.id, holdUntil: concurrent.holdUntil, platformFeeCents: concurrent.platformFeeCents, merchantNetCents: concurrent.merchantNetCents };
    }
  }
}

/**
 * Ends the buyer return window. It does not send money and does not mark a
 * hold released; `released` requires a confirmed provider transfer receipt.
 */
@Injectable()
export class MakePaymentHoldsPayoutReadyUseCase {
  private readonly logger = new Logger(MakePaymentHoldsPayoutReadyUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(now = new Date()): Promise<{ payoutReady: number }> {
    const result = await (this.prisma as any).paymentHold.updateMany({
      where: { status: "held", holdUntil: { lte: now } },
      data: { status: "payout_ready" },
    });
    const payoutReady = result.count ?? 0;
    if (payoutReady > 0) this.logger.log(`${payoutReady} payment hold(s) are ready for provider payout`);
    return { payoutReady };
  }
}

@Injectable()
export class RefundPaymentHoldUseCase {
  private readonly logger = new Logger(RefundPaymentHoldUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(paymentIntentId: string): Promise<PaymentHoldStatus | undefined> {
    const hold = await (this.prisma as any).paymentHold.findUnique({ where: { paymentIntentId } }) as { id: string; status: PaymentHoldStatus } | null;
    if (!hold) return undefined;
    if (hold.status === "refunded" || hold.status === "chargebacked" || hold.status === "chargeback_debt") return hold.status;

    const status: PaymentHoldStatus = hold.status === "payout_submitted" || hold.status === "released" ? "refund_reversal_required" : "refunded";
    await (this.prisma as any).paymentHold.update({ where: { id: hold.id }, data: { status } });
    this.logger.log(`Payment hold ${hold.id} marked ${status}`);
    return status;
  }
}

@Injectable()
export class ChargebackPaymentHoldUseCase {
  private readonly logger = new Logger(ChargebackPaymentHoldUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(paymentIntentId: string): Promise<PaymentHoldStatus | undefined> {
    const hold = await (this.prisma as any).paymentHold.findUnique({ where: { paymentIntentId } }) as { id: string; status: PaymentHoldStatus } | null;
    if (!hold) return undefined;
    if (hold.status === "chargebacked" || hold.status === "chargeback_debt") return hold.status;

    const status: PaymentHoldStatus = hold.status === "payout_submitted" || hold.status === "released" ? "chargeback_debt" : "chargebacked";
    await (this.prisma as any).paymentHold.update({ where: { id: hold.id }, data: { status } });
    this.logger.log(`Payment hold ${hold.id} marked ${status}`);
    return status;
  }
}
