import { ConflictException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type {
  PaymentPlatformRepository,
  BillingMutation,
  BillingWebhookMutation,
  BillingWebhookOutcome,
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
    provider: "stripe" | "asaas" | "mercadopago",
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
    provider: "stripe" | "asaas" | "mercadopago",
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
    await this.prisma.$transaction(async (tx) => {
      // Serialize distinct provider callbacks for one merchant. Without this
      // lock two OAuth callbacks could both see one free slot and create a
      // third gateway.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${merchantId}))`;
      const current = await tx.merchantPaymentConnection.findUnique({
        where: { merchantId_provider: { merchantId, provider: input.provider } },
        select: { provider: true },
      });
      if (!current) {
        const count = await tx.merchantPaymentConnection.count({ where: { merchantId } });
        if (count >= 2) {
          throw new ConflictException("payment_provider_connection_limit_reached");
        }
      }
      await tx.merchantPaymentConnection.upsert({
        where: { merchantId_provider: { merchantId, provider: input.provider } },
        create: { merchantId, provider: input.provider, ...data },
        update: data,
      });
    });
  }

  async deleteConnection(
    merchantId: string,
    provider: "stripe" | "asaas" | "mercadopago",
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
        planKey: "starter",
        provider: "stripe",
        trialEndsAt,
      },
    });
    return toBilling(row);
  }

  async saveBilling(input: SaveBillingSubscriptionInput): Promise<void> {
    const update = billingUpdate(input);
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

  async mutateBilling(merchantId: string, decide: BillingMutation): Promise<BillingSubscriptionSnapshot | undefined> {
    const scopedMerchantId = merchantId.trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT merchant_id FROM merchant_billing_subscriptions WHERE merchant_id = ${scopedMerchantId} FOR UPDATE`;
      const row = await tx.merchantBillingSubscription.findUnique({ where: { merchantId: scopedMerchantId } });
      if (!row) return undefined;
      const update = decide(toBilling(row));
      if (!update) return toBilling(row);
      if (update.merchantId !== scopedMerchantId) throw new Error("billing_mutation_scope_mismatch");
      return toBilling(await tx.merchantBillingSubscription.update({ where: { merchantId: scopedMerchantId }, data: billingUpdate(update) }));
    });
  }

  async processBillingWebhook(input: BillingWebhookMutation, decide: BillingMutation): Promise<BillingWebhookOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // The event lock also serializes a replay that names another subscription.
      const eventLock = `asaas-billing-event:${input.eventId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventLock}))`;
      const duplicate = await tx.billingWebhookEvent.findUnique({ where: { provider_eventId: { provider: "asaas", eventId: input.eventId } } });
      if (duplicate) return "duplicate";
      await tx.$queryRaw`SELECT merchant_id FROM merchant_billing_subscriptions WHERE merchant_id = ${input.merchantId} FOR UPDATE`;
      const row = await tx.merchantBillingSubscription.findUnique({ where: { merchantId: input.merchantId } });
      const update = row && row.asaasSubscriptionId === input.subscriptionId && row.provider !== "stripe"
        ? decide(toBilling(row)) : undefined;
      if (update) {
        if (update.merchantId !== input.merchantId) throw new Error("billing_mutation_scope_mismatch");
        await tx.merchantBillingSubscription.update({ where: { merchantId: input.merchantId }, data: billingUpdate(update) });
      }
      const outcome = update ? "processed" : "ignored";
      await tx.billingWebhookEvent.create({ data: { provider: "asaas", eventId: input.eventId,
        merchantId: input.merchantId, subscriptionId: input.subscriptionId, paymentId: input.paymentId,
        occurredAt: new Date(input.occurredAt), outcome } });
      return outcome;
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

  async listBillingCancellationsNeedingProviderSuspend(
    limit: number,
  ): Promise<BillingSubscriptionSnapshot[]> {
    const rows = await this.prisma.merchantBillingSubscription.findMany({
      where: {
        cancelAtPeriodEnd: true,
        providerCancellationScheduledAt: null,
        asaasSubscriptionId: { not: null },
        status: { not: "cancelled" },
      },
      orderBy: { currentPeriodEnd: "asc" },
      take: Math.max(1, Math.trunc(limit)),
    });
    return rows.map(toBilling);
  }

  async listDueBillingCancellations(
    now: Date,
    limit: number,
  ): Promise<BillingSubscriptionSnapshot[]> {
    const rows = await this.prisma.merchantBillingSubscription.findMany({
      where: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { not: null, lte: now },
        asaasSubscriptionId: { not: null },
        status: { not: "cancelled" },
      },
      orderBy: { currentPeriodEnd: "asc" },
      take: Math.max(1, Math.trunc(limit)),
    });
    return rows.map(toBilling);
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
  pendingUpgradePlanKey?: string | null;
  pendingUpgradeAmountCents?: number | null;
  pendingUpgradeRequestedAt?: Date | null;
  billingAmountCents?: number | null;
  billingCycle?: string | null;
  billingDiscountPercent?: number | null;
  pendingBillingCycle?: string | null;
  pendingBillingAmountCents?: number | null;
  pendingBillingDiscountPercent?: number | null;
  lastBillingEventAt?: Date | null;
  lastBillingPaymentId?: string | null;
  lastBillingPaymentDueAt?: Date | null;
  pendingPlanEffectiveAt?: Date | null;
  providerCancellationScheduledAt?: Date | null;
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
    pendingUpgradePlanKey: toPlanKey(row.pendingUpgradePlanKey),
    pendingUpgradeAmountCents: row.pendingUpgradeAmountCents ?? undefined,
    pendingUpgradeRequestedAt: row.pendingUpgradeRequestedAt?.toISOString(),
    billingAmountCents: row.billingAmountCents ?? undefined,
    billingCycle: row.billingCycle === "annual" ? "annual" : "monthly",
    billingDiscountPercent: row.billingDiscountPercent ?? 0,
    pendingBillingCycle: row.pendingBillingCycle === "annual" ? "annual" : row.pendingBillingCycle === "monthly" ? "monthly" : undefined,
    pendingBillingAmountCents: row.pendingBillingAmountCents ?? undefined,
    pendingBillingDiscountPercent: row.pendingBillingDiscountPercent ?? undefined,
    lastBillingEventAt: row.lastBillingEventAt?.toISOString(),
    lastBillingPaymentId: row.lastBillingPaymentId ?? undefined,
    lastBillingPaymentDueAt: row.lastBillingPaymentDueAt?.toISOString(),
    pendingPlanEffectiveAt: row.pendingPlanEffectiveAt?.toISOString(),
    providerCancellationScheduledAt: row.providerCancellationScheduledAt?.toISOString(),
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

function billingUpdate(input: SaveBillingSubscriptionInput) {
  return {
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
      ...(input.providerCancellationScheduledAt !== undefined
        ? {
            providerCancellationScheduledAt: input.providerCancellationScheduledAt
              ? new Date(input.providerCancellationScheduledAt)
              : null,
          }
        : {}),
      ...(input.pendingUpgradePlanKey !== undefined ? { pendingUpgradePlanKey: input.pendingUpgradePlanKey } : {}),
      ...(input.pendingUpgradeAmountCents !== undefined ? { pendingUpgradeAmountCents: input.pendingUpgradeAmountCents } : {}),
      ...(input.billingAmountCents !== undefined ? { billingAmountCents: input.billingAmountCents } : {}),
      ...(input.billingCycle !== undefined ? { billingCycle: input.billingCycle } : {}),
      ...(input.billingDiscountPercent !== undefined ? { billingDiscountPercent: input.billingDiscountPercent } : {}),
      ...(input.pendingBillingCycle !== undefined ? { pendingBillingCycle: input.pendingBillingCycle } : {}),
      ...(input.pendingBillingAmountCents !== undefined ? { pendingBillingAmountCents: input.pendingBillingAmountCents } : {}),
      ...(input.pendingBillingDiscountPercent !== undefined ? { pendingBillingDiscountPercent: input.pendingBillingDiscountPercent } : {}),
      ...(input.lastBillingPaymentId !== undefined ? { lastBillingPaymentId: input.lastBillingPaymentId } : {}),
      ...(input.pendingUpgradeRequestedAt !== undefined ? { pendingUpgradeRequestedAt: input.pendingUpgradeRequestedAt ? new Date(input.pendingUpgradeRequestedAt) : null } : {}),
      ...(input.lastBillingEventAt !== undefined ? { lastBillingEventAt: input.lastBillingEventAt ? new Date(input.lastBillingEventAt) : null } : {}),
      ...(input.lastBillingPaymentDueAt !== undefined ? { lastBillingPaymentDueAt: input.lastBillingPaymentDueAt ? new Date(input.lastBillingPaymentDueAt) : null } : {}),
    };
}
