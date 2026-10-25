import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  PaymentSettlementLedgerPort,
  PaymentSettlementSnapshot,
  ObservedPaymentSettlement,
  PlannedPaymentSettlement,
} from "../domain/ports/payment-settlement-ledger.port.js";
import { normalizePlannedSettlement, normalizeSettlementObservation } from "../domain/ports/payment-settlement-ledger.port.js";

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
  status: string;
  currency: string;
  providerPaymentId: string | null;
  providerSettlementId: string | null;
  providerReference: string | null;
  plannedGrossCents: number;
  plannedPlatformFeeCents: number;
  plannedMerchantNetCents: number;
  plannedProviderFeeCents: number;
  confirmedGrossCents: number | null;
  confirmedPlatformFeeCents: number | null;
  confirmedMerchantNetCents: number | null;
  confirmedProviderFeeCents: number | null;
  occurredAt: Date;
  confirmedAt: Date | null;
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
    status: string;
    occurredAt: Date;
    confirmedAmountCents: number | null;
    providerTransferId: string | null;
    providerReference: string | null;
    confirmedAt: Date | null;
  }>;
}): PaymentSettlementSnapshot {
  return {
    merchantId: row.merchantId,
    paymentIntentId: row.paymentIntentId,
    sequence: row.sequence,
    provider: row.provider,
    status: row.status as PaymentSettlementSnapshot["status"],
    currency: row.currency,
    providerPaymentId: row.providerPaymentId ?? undefined,
    providerSettlementId: row.providerSettlementId ?? undefined,
    providerReference: row.providerReference ?? undefined,
    plannedGrossCents: row.plannedGrossCents,
    plannedPlatformFeeCents: row.plannedPlatformFeeCents,
    plannedMerchantNetCents: row.plannedMerchantNetCents,
    plannedProviderFeeCents: row.plannedProviderFeeCents,
    confirmedGrossCents: row.confirmedGrossCents ?? undefined,
    confirmedPlatformFeeCents: row.confirmedPlatformFeeCents ?? undefined,
    confirmedMerchantNetCents: row.confirmedMerchantNetCents ?? undefined,
    confirmedProviderFeeCents: row.confirmedProviderFeeCents ?? undefined,
    occurredAt: new Date(row.occurredAt),
    confirmedAt: row.confirmedAt ?? undefined,
    entries: row.entries.map(entry => ({
      sequence: entry.sequence,
      entryKey: entry.entryKey as "platform_fee" | "merchant_payout",
      entryType: entry.entryType as "platform_fee" | "merchant_payout",
      direction: "credit",
      recipientType: entry.recipientType as "platform" | "merchant",
      recipientReference: entry.recipientReference ?? undefined,
      status: entry.status as PaymentSettlementSnapshot["entries"][number]["status"],
      currency: entry.currency,
      provider: entry.provider,
      plannedAmountCents: entry.plannedAmountCents,
      confirmedAmountCents: entry.confirmedAmountCents ?? undefined,
      providerTransferId: entry.providerTransferId ?? undefined,
      providerReference: entry.providerReference ?? undefined,
      occurredAt: new Date(entry.occurredAt),
      confirmedAt: entry.confirmedAt ?? undefined,
    })),
  };
}

export class PrismaPaymentSettlementLedgerRepository implements PaymentSettlementLedgerPort {
  constructor(private readonly prisma: PrismaClient) {}

  async appendPlanned(plan: PlannedPaymentSettlement): Promise<void> {
    await this.prisma.$transaction(tx => appendPlannedSettlementInTransaction(tx, plan));
  }

  async appendObservation(rawObservation: ObservedPaymentSettlement): Promise<void> {
    const observation = normalizeSettlementObservation(rawObservation);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.$transaction(async tx => {
          const planned = await tx.paymentSettlement.findUnique({
            where: {
              merchantId_paymentIntentId_sequence: {
                merchantId: observation.merchantId,
                paymentIntentId: observation.paymentIntentId,
                sequence: 1,
              },
            },
            include: { entries: { orderBy: { sequence: "asc" } } },
          });
          if (!planned || planned.status !== "planned") throw new Error("payment_settlement_plan_missing");
          if (planned.provider !== observation.provider || planned.currency !== observation.currency) {
            throw new Error("payment_settlement_observation_scope_invalid");
          }
          const duplicate = await tx.paymentSettlement.findFirst({
            where: {
              merchantId: observation.merchantId,
              provider: observation.provider,
              providerSettlementId: observation.providerSettlementId,
            },
            select: { id: true },
          });
          if (duplicate) return;
          const latest = await tx.paymentSettlement.findFirst({
            where: { merchantId: observation.merchantId, paymentIntentId: observation.paymentIntentId },
            orderBy: { sequence: "desc" },
            select: { sequence: true },
          });
          const plannedEntries = new Map(planned.entries.map(entry => [entry.entryKey, entry]));
          const entries = observation.entries.map((entry, index) => {
            const source = plannedEntries.get(entry.entryKey);
            if (!source) throw new Error("payment_settlement_observation_entry_invalid");
            return {
              merchantId: observation.merchantId,
              sequence: index + 1,
              entryKey: source.entryKey,
              entryType: source.entryType,
              direction: source.direction,
              recipientType: source.recipientType,
              recipientReference: source.recipientReference,
              status: observation.status,
              currency: planned.currency,
              plannedAmountCents: source.plannedAmountCents,
              confirmedAmountCents: entry.confirmedAmountCents ?? null,
              provider: observation.provider,
              providerTransferId: entry.providerTransferId ?? null,
              providerReference: entry.providerReference ?? observation.providerReference ?? null,
              occurredAt: observation.occurredAt,
              confirmedAt: observation.confirmedAt ?? null,
            };
          });
          const settlement = await tx.paymentSettlement.create({
            data: {
              merchantId: observation.merchantId,
              paymentIntentId: observation.paymentIntentId,
              sequence: (latest?.sequence ?? 0) + 1,
              provider: observation.provider,
              status: observation.status,
              currency: planned.currency,
              providerPaymentId: observation.providerPaymentId ?? null,
              providerSettlementId: observation.providerSettlementId,
              providerReference: observation.providerReference ?? null,
              plannedGrossCents: planned.plannedGrossCents,
              plannedPlatformFeeCents: planned.plannedPlatformFeeCents,
              plannedMerchantNetCents: planned.plannedMerchantNetCents,
              plannedProviderFeeCents: planned.plannedProviderFeeCents,
              confirmedGrossCents: observation.confirmedGrossCents ?? null,
              confirmedPlatformFeeCents: observation.confirmedPlatformFeeCents ?? null,
              confirmedMerchantNetCents: observation.confirmedMerchantNetCents ?? null,
              confirmedProviderFeeCents: observation.confirmedProviderFeeCents ?? null,
              occurredAt: observation.occurredAt,
              confirmedAt: observation.confirmedAt ?? null,
            },
          });
          if (entries.length) {
            await tx.paymentSettlementEntry.createMany({
              data: entries.map(entry => ({ ...entry, settlementId: settlement.id })),
            });
          }
        });
        return;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        const duplicate = await this.prisma.paymentSettlement.findFirst({
          where: {
            merchantId: observation.merchantId,
            provider: observation.provider,
            providerSettlementId: observation.providerSettlementId,
          },
          select: { id: true },
        });
        if (duplicate) return;
      }
    }
    throw new Error("payment_settlement_observation_append_conflict");
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
