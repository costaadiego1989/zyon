import type { PrismaClient } from "@prisma/client";
import type {
  PaymentPlatformRepository,
  SaveBillingSubscriptionInput,
  SavePaymentConnectionInput,
} from "../domain/ports/payment-platform-repository.port.js";
import type {
  BillingSubscriptionSnapshot,
  PaymentConnectionSnapshot,
} from "../domain/payment-platform.types.js";
import {
  decryptPaymentSecret,
  encryptPaymentSecret,
} from "./payment-secret-cipher.js";

export class PrismaPaymentPlatformRepository
  implements PaymentPlatformRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async listConnections(
    merchantId: string,
  ): Promise<PaymentConnectionSnapshot[]> {
    const rows = await this.prisma.merchantPaymentConnection.findMany({
      where: { merchantId: merchantId.trim() },
      orderBy: { provider: "asc" },
    });
    return rows.map(toConnection);
  }

  async getConnection(
    merchantId: string,
    provider: "stripe" | "asaas",
  ): Promise<PaymentConnectionSnapshot | undefined> {
    const row = await this.prisma.merchantPaymentConnection.findUnique({
      where: {
        merchantId_provider: {
          merchantId: merchantId.trim(),
          provider,
        },
      },
    });
    return row ? toConnection(row) : undefined;
  }

  async getConnectionSecret(
    merchantId: string,
    provider: "stripe" | "asaas",
  ): Promise<string | undefined> {
    const row = await this.prisma.merchantPaymentConnection.findUnique({
      where: {
        merchantId_provider: {
          merchantId: merchantId.trim(),
          provider,
        },
      },
      select: { secretCipher: true },
    });
    return row?.secretCipher
      ? decryptPaymentSecret(row.secretCipher)
      : undefined;
  }

  async saveConnection(input: SavePaymentConnectionInput): Promise<void> {
    const merchantId = input.merchantId.trim();
    const data = {
      environment: input.environment,
      status: input.status,
      externalAccountId: input.externalAccountId ?? null,
      walletId: input.walletId ?? null,
      chargesEnabled: input.chargesEnabled ?? false,
      payoutsEnabled: input.payoutsEnabled ?? false,
      requirements: input.requirements ?? [],
      lastSyncedAt: input.syncedAt ? new Date(input.syncedAt) : null,
      lastErrorCode: input.errorCode ?? null,
      ...(input.secret
        ? { secretCipher: encryptPaymentSecret(input.secret) }
        : {}),
    };
    await this.prisma.merchantPaymentConnection.upsert({
      where: {
        merchantId_provider: {
          merchantId,
          provider: input.provider,
        },
      },
      create: {
        merchantId,
        provider: input.provider,
        ...data,
      },
      update: data,
    });
  }

  async deleteConnection(
    merchantId: string,
    provider: "stripe" | "asaas",
  ): Promise<void> {
    await this.prisma.merchantPaymentConnection.deleteMany({
      where: { merchantId: merchantId.trim(), provider },
    });
  }

  async getOrCreateTrial(
    merchantId: string,
    trialDays: number,
  ): Promise<BillingSubscriptionSnapshot> {
    const trialEndsAt = new Date(
      Date.now() + Math.max(1, trialDays) * 86_400_000,
    );
    const scopedMerchantId = merchantId.trim();
    const existing = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: scopedMerchantId },
    });
    if (
      existing?.status === "trialing" &&
      existing.trialEndsAt &&
      existing.trialEndsAt.getTime() <= Date.now() &&
      !existing.stripeSubscriptionId
    ) {
      const row = await this.prisma.merchantBillingSubscription.update({
        where: { merchantId: scopedMerchantId },
        data: {
          status: "starter",
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        },
      });
      return toBilling(row);
    }
    if (existing) return toBilling(existing);
    const row = await this.prisma.merchantBillingSubscription.create({
      data: {
        merchantId: scopedMerchantId,
        status: "trialing",
        trialEndsAt,
      },
    });
    return toBilling(row);
  }

  async saveBilling(input: SaveBillingSubscriptionInput): Promise<void> {
    const update = {
      ...(input.stripeCustomerId !== undefined
        ? { stripeCustomerId: input.stripeCustomerId || null }
        : {}),
      ...(input.stripeSubscriptionId !== undefined
        ? { stripeSubscriptionId: input.stripeSubscriptionId || null }
        : {}),
      ...(input.stripePriceId !== undefined
        ? { stripePriceId: input.stripePriceId || null }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.trialEndsAt !== undefined
        ? {
            trialEndsAt: input.trialEndsAt
              ? new Date(input.trialEndsAt)
              : null,
          }
        : {}),
      ...(input.currentPeriodEnd !== undefined
        ? {
            currentPeriodEnd: input.currentPeriodEnd
              ? new Date(input.currentPeriodEnd)
              : null,
          }
        : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
        : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.planKey !== undefined ? { planKey: input.planKey ?? null } : {}),
      ...(input.asaasCustomerId !== undefined
        ? { asaasCustomerId: input.asaasCustomerId || null }
        : {}),
      ...(input.asaasSubscriptionId !== undefined
        ? { asaasSubscriptionId: input.asaasSubscriptionId || null }
        : {}),
      ...(input.pendingPlanKey !== undefined
        ? { pendingPlanKey: input.pendingPlanKey ?? null }
        : {}),
      ...(input.pendingPlanEffectiveAt !== undefined
        ? {
            pendingPlanEffectiveAt: input.pendingPlanEffectiveAt
              ? new Date(input.pendingPlanEffectiveAt)
              : null,
          }
        : {}),
    };
    await this.prisma.merchantBillingSubscription.upsert({
      where: { merchantId: input.merchantId.trim() },
      create: {
        merchantId: input.merchantId.trim(),
        status: input.status ?? "trialing",
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        ...update,
      },
      update,
    });
  }

  async getBilling(
    merchantId: string,
  ): Promise<BillingSubscriptionSnapshot | undefined> {
    const row = await this.prisma.merchantBillingSubscription.findUnique({
      where: { merchantId: merchantId.trim() },
    });
    return row ? toBilling(row) : undefined;
  }

  async expireTrial(merchantId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.merchantBillingSubscription.updateMany({
      where: {
        merchantId: merchantId.trim(),
        status: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: { lte: now },
      },
      data: {
        status: "starter",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    });
    return result.count > 0;
  }

  async expireTrials(now: Date, limit: number): Promise<number> {
    const rows = await this.prisma.merchantBillingSubscription.findMany({
      where: {
        status: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: { lte: now },
      },
      select: { merchantId: true },
      orderBy: { trialEndsAt: "asc" },
      take: Math.max(1, Math.trunc(limit)),
    });
    if (!rows.length) return 0;
    const result = await this.prisma.merchantBillingSubscription.updateMany({
      where: {
        merchantId: { in: rows.map((row) => row.merchantId) },
        status: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: { lte: now },
      },
      data: {
        status: "starter",
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    });
    return result.count;
  }

  async findMerchantByStripeCustomerId(
    customerId: string,
  ): Promise<string | undefined> {
    const row = await this.prisma.merchantBillingSubscription.findUnique({
      where: { stripeCustomerId: customerId.trim() },
      select: { merchantId: true },
    });
    return row?.merchantId;
  }

  async findMerchantByStripeSubscriptionId(
    subscriptionId: string,
  ): Promise<string | undefined> {
    const row = await this.prisma.merchantBillingSubscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId.trim() },
      select: { merchantId: true },
    });
    return row?.merchantId;
  }

  async findMerchantByAsaasSubscriptionId(
    subscriptionId: string,
  ): Promise<string | undefined> {
    const row = await this.prisma.merchantBillingSubscription.findFirst({
      where: { asaasSubscriptionId: subscriptionId.trim() },
      select: { merchantId: true },
    });
    return row?.merchantId ?? undefined;
  }
}

function toConnection(row: {
  merchantId: string;
  provider: string;
  environment: string;
  status: string;
  externalAccountId: string | null;
  walletId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: unknown;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentConnectionSnapshot {
  if (
    row.provider !== "stripe" &&
    row.provider !== "asaas" &&
    row.provider !== "mercadopago"
  ) {
    throw new Error("payment_connection_provider_invalid");
  }
  return {
    merchantId: row.merchantId,
    provider: row.provider,
    environment: row.environment === "live" ? "live" : "test",
    status: toConnectionStatus(row.status),
    externalAccountId: row.externalAccountId ?? undefined,
    walletId: row.walletId ?? undefined,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    requirements: Array.isArray(row.requirements)
      ? row.requirements.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    lastSyncedAt: row.lastSyncedAt?.toISOString(),
    lastErrorCode: row.lastErrorCode ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toConnectionStatus(
  value: string,
): PaymentConnectionSnapshot["status"] {
  if (
    value === "active" ||
    value === "restricted" ||
    value === "degraded"
  ) {
    return value;
  }
  return "pending";
}

function toBilling(row: {
  merchantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
  provider?: string | null;
  planKey?: string | null;
  asaasCustomerId?: string | null;
  asaasSubscriptionId?: string | null;
  pendingPlanKey?: string | null;
  pendingPlanEffectiveAt?: Date | null;
}): BillingSubscriptionSnapshot {
  return {
    merchantId: row.merchantId,
    stripeCustomerId: row.stripeCustomerId ?? undefined,
    stripeSubscriptionId: row.stripeSubscriptionId ?? undefined,
    stripePriceId: row.stripePriceId ?? undefined,
    status: toBillingStatus(row.status),
    trialEndsAt: row.trialEndsAt?.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd?.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    provider: row.provider === "stripe" ? "stripe" : row.provider === "asaas" ? "asaas" : undefined,
    planKey: toPlanKey(row.planKey),
    asaasCustomerId: row.asaasCustomerId ?? undefined,
    asaasSubscriptionId: row.asaasSubscriptionId ?? undefined,
    pendingPlanKey: toPlanKey(row.pendingPlanKey),
    pendingPlanEffectiveAt: row.pendingPlanEffectiveAt?.toISOString(),
  };
}

function toPlanKey(v: string | null | undefined): BillingSubscriptionSnapshot["planKey"] {
  return v === "starter" || v === "growth" || v === "scale" ? v : undefined;
}

function toBillingStatus(
  status: string,
): BillingSubscriptionSnapshot["status"] {
  if (
    status === "starter" ||
    status === "active" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "paused" ||
    status === "cancelled" ||
    status === "incomplete"
  ) {
    return status;
  }
  return "trialing";
}
