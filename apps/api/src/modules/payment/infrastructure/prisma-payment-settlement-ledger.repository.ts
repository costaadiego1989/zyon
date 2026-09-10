import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  PaymentSettlementLedgerPort,
  PaymentSettlementSnapshot,
  PlannedPaymentSettlement,
} from "../domain/ports/payment-settlement-ledger.port.js";
import { normalizePlannedSettlement } from "../domain/ports/payment-settlement-ledger.port.js";

type PrismaLedgerClient = PrismaClient | Prisma.TransactionClient;

function samePlan(existing: {
  provider: string;
  currency: string;
  providerReference: string | null;
  plannedGrossCents: number;
  plannedPlatformFeeCents: number;
  plannedMerchantNetCents: number;
  plannedProviderFeeCents: number;
}, plan: PlannedPaymentSettlement): boolean {
  return existing.provider === plan.provider &&
    existing.currency === plan.currency &&
    existing.providerReference === (plan.providerReference ?? null) &&
    existing.plannedGrossCents === plan.plannedGrossCents &&
    existing.plannedPlatformFeeCents === plan.plannedPlatformFeeCents &&
    existing.plannedMerchantNetCents === plan.plannedMerchantNetCents &&
    existing.plannedProviderFeeCents === plan.plannedProviderFeeCents;
}

/**
 * Used by the intent repository inside its transaction so an intent never
 * becomes durable without its financial plan (or vice versa).
 */
export async function appendPlannedSettlementInTransaction(
  prisma: PrismaLedgerClient,
  rawPlan: PlannedPaymentSettlement,
): Promise<void> {
  const plan = normalizePlannedSettlement(rawPlan);
  const where = {
    merchantId_paymentIntentId_sequence: {
      merchantId: plan.merchantId,
      paymentIntentId: plan.paymentIntentId,
      sequence: 1,
    },
  };
  const existing = await prisma.paymentSettlement.findUnique({ where });
  if (existing) {
    if (!samePlan(existing, plan)) throw new Error("payment_settlement_plan_conflict");
    return;
  }

  try {
    const settlement = await prisma.paymentSettlement.create({
      data: {
        merchantId: plan.merchantId,
        paymentIntentId: plan.paymentIntentId,
        sequence: 1,
        provider: plan.provider,
        status: "planned",
        currency: plan.currency,
        providerReference: plan.providerReference ?? null,
        plannedGrossCents: plan.plannedGrossCents,
        plannedPlatformFeeCents: plan.plannedPlatformFeeCents,
        plannedMerchantNetCents: plan.plannedMerchantNetCents,
        plannedProviderFeeCents: plan.plannedProviderFeeCents,
        occurredAt: plan.occurredAt,
      },
    });
    if (plan.entries.length) {
      await prisma.paymentSettlementEntry.createMany({
        data: plan.entries.map((entry, index) => ({
          merchantId: plan.merchantId,
          settlementId: settlement.id,
          sequence: index + 1,
          entryKey: entry.entryKey,
          entryType: entry.entryType,
          direction: entry.direction,
          recipientType: entry.recipientType,
          recipientReference: entry.recipientReference ?? null,
          status: "planned",
          currency: plan.currency,
          plannedAmountCents: entry.plannedAmountCents,
          provider: plan.provider,
          providerReference: plan.providerReference ?? null,
          occurredAt: plan.occurredAt,
        })),
      });
    }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await prisma.paymentSettlement.findUnique({ where });
    if (!concurrent || !samePlan(concurrent, plan)) throw new Error("payment_settlement_plan_conflict");
  }
}

function snapshot(row: {
  merchantId: string;
  paymentIntentId: string;
  sequence: number;
  provider: string;
  currency: string;
  providerReference: string | null;
  plannedGrossCents: number;
  plannedPlatformFeeCents: number;
  plannedMerchantNetCents: number;
  plannedProviderFeeCents: number;
  occurredAt: Date;
  entries: Array<{
    sequence: number;
    entryKey: string;
    entryType: string;
    direction: string;
    recipientType: string;
    recipientReference: string | null;
    plannedAmountCents: number;
    currency: string;
    provider: string;
    occurredAt: Date;
  }>;
}): PaymentSettlementSnapshot {
  return {
    merchantId: row.merchantId,
    paymentIntentId: row.paymentIntentId,
    sequence: row.sequence,
    provider: row.provider,
    status: "planned",
    currency: row.currency,
    providerReference: row.providerReference ?? undefined,
    plannedGrossCents: row.plannedGrossCents,
    plannedPlatformFeeCents: row.plannedPlatformFeeCents,
    plannedMerchantNetCents: row.plannedMerchantNetCents,
    plannedProviderFeeCents: row.plannedProviderFeeCents,
    occurredAt: new Date(row.occurredAt),
    entries: row.entries.map(entry => ({
      sequence: entry.sequence,
      entryKey: entry.entryKey as "platform_fee" | "merchant_payout",
      entryType: entry.entryType as "platform_fee" | "merchant_payout",
      direction: "credit",
      recipientType: entry.recipientType as "platform" | "merchant",
      recipientReference: entry.recipientReference ?? undefined,
      status: "planned",
      currency: entry.currency,
      provider: entry.provider,
      plannedAmountCents: entry.plannedAmountCents,
      occurredAt: new Date(entry.occurredAt),
    })),
  };
}

export class PrismaPaymentSettlementLedgerRepository implements PaymentSettlementLedgerPort {
  constructor(private readonly prisma: PrismaClient) {}

  async appendPlanned(plan: PlannedPaymentSettlement): Promise<void> {
    await this.prisma.$transaction(tx => appendPlannedSettlementInTransaction(tx, plan));
  }

  async listForPaymentIntent(merchantId: string, paymentIntentId: string): Promise<PaymentSettlementSnapshot[]> {
    const rows = await this.prisma.paymentSettlement.findMany({
      where: { merchantId: merchantId.trim(), paymentIntentId: paymentIntentId.trim() },
      include: { entries: { orderBy: { sequence: "asc" } } },
      orderBy: { sequence: "asc" },
    });
    return rows.map(snapshot);
  }
}
