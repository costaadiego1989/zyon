import type {
  PaymentPlatformRepository,
  SaveBillingSubscriptionInput,
  SavePaymentConnectionInput,
} from "../domain/ports/payment-platform-repository.port.js";
import type {
  BillingSubscriptionSnapshot,
  PaymentConnectionSnapshot,
} from "../domain/payment-platform.types.js";

export class InMemoryPaymentPlatformRepository
  implements PaymentPlatformRepository
{
  private readonly connections = new Map<
    string,
    PaymentConnectionSnapshot
  >();
  private readonly secrets = new Map<string, string>();
  private readonly billing = new Map<
    string,
    BillingSubscriptionSnapshot
  >();

  async listConnections(
    merchantId: string,
  ): Promise<PaymentConnectionSnapshot[]> {
    return [...this.connections.values()].filter(
      (connection) => connection.merchantId === merchantId,
    );
  }

  async getConnection(
    merchantId: string,
    provider: "stripe" | "asaas",
  ): Promise<PaymentConnectionSnapshot | undefined> {
    return this.connections.get(key(merchantId, provider));
  }

  async getConnectionSecret(
    merchantId: string,
    provider: "stripe" | "asaas",
  ): Promise<string | undefined> {
    return this.secrets.get(key(merchantId, provider));
  }

  async saveConnection(input: SavePaymentConnectionInput): Promise<void> {
    const recordKey = key(input.merchantId, input.provider);
    const current = this.connections.get(recordKey);
    const now = new Date().toISOString();
    this.connections.set(recordKey, {
      merchantId: input.merchantId,
      provider: input.provider,
      environment: input.environment,
      status: input.status,
      externalAccountId: input.externalAccountId,
      walletId: input.walletId,
      chargesEnabled: input.chargesEnabled ?? false,
      payoutsEnabled: input.payoutsEnabled ?? false,
      requirements: input.requirements ?? [],
      lastSyncedAt: input.syncedAt,
      lastErrorCode: input.errorCode,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
    if (input.secret) this.secrets.set(recordKey, input.secret);
  }

  async deleteConnection(
    merchantId: string,
    provider: "stripe" | "asaas",
  ): Promise<void> {
    this.connections.delete(key(merchantId, provider));
    this.secrets.delete(key(merchantId, provider));
  }

  async getOrCreateTrial(
    merchantId: string,
    trialDays: number,
  ): Promise<BillingSubscriptionSnapshot> {
    const existing = this.billing.get(merchantId);
    if (existing) {
      if (
        existing.status === "trialing" &&
        existing.trialEndsAt &&
        new Date(existing.trialEndsAt).getTime() <= Date.now() &&
        !existing.stripeSubscriptionId
      ) {
        const expired = {
          ...existing,
          status: "starter" as const,
          trialEndsAt: undefined,
          currentPeriodEnd: undefined,
          cancelAtPeriodEnd: false,
          updatedAt: new Date().toISOString(),
        };
        this.billing.set(merchantId, expired);
        return expired;
      }
      return existing;
    }
    const now = new Date();
    const snapshot: BillingSubscriptionSnapshot = {
      merchantId,
      status: "trialing",
      trialEndsAt: new Date(
        now.getTime() + trialDays * 86_400_000,
      ).toISOString(),
      cancelAtPeriodEnd: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.billing.set(merchantId, snapshot);
    return snapshot;
  }

  async saveBilling(input: SaveBillingSubscriptionInput): Promise<void> {
    const current =
      this.billing.get(input.merchantId) ??
      (await this.getOrCreateTrial(input.merchantId, 14));
    // SaveBillingSubscriptionInput allows null on pendingPlanEffectiveAt (clear);
    // the snapshot uses undefined. Normalize: undefined = keep current, null = clear.
    const pendingEffective =
      input.pendingPlanEffectiveAt === undefined
        ? current.pendingPlanEffectiveAt
        : (input.pendingPlanEffectiveAt ?? undefined);
    this.billing.set(input.merchantId, {
      ...current,
      ...input,
      pendingPlanEffectiveAt: pendingEffective,
      updatedAt: new Date().toISOString(),
    });
  }

  async getBilling(
    merchantId: string,
  ): Promise<BillingSubscriptionSnapshot | undefined> {
    return this.billing.get(merchantId);
  }

  async expireTrial(merchantId: string, now: Date): Promise<boolean> {
    const billing = this.billing.get(merchantId);
    if (
      !billing ||
      billing.status !== "trialing" ||
      billing.stripeSubscriptionId ||
      !billing.trialEndsAt ||
      new Date(billing.trialEndsAt).getTime() > now.getTime()
    ) {
      return false;
    }
    this.billing.set(merchantId, {
      ...billing,
      status: "starter",
      trialEndsAt: undefined,
      currentPeriodEnd: undefined,
      cancelAtPeriodEnd: false,
      updatedAt: now.toISOString(),
    });
    return true;
  }

  async expireTrials(now: Date, limit: number): Promise<number> {
    let count = 0;
    const max = Math.max(1, Math.trunc(limit));
    for (const [merchantId, billing] of this.billing.entries()) {
      if (count >= max) break;
      if (
        billing.status !== "trialing" ||
        billing.stripeSubscriptionId ||
        !billing.trialEndsAt ||
        new Date(billing.trialEndsAt).getTime() > now.getTime()
      ) {
        continue;
      }
      this.billing.set(merchantId, {
        ...billing,
        status: "starter",
        trialEndsAt: undefined,
        currentPeriodEnd: undefined,
        cancelAtPeriodEnd: false,
        updatedAt: now.toISOString(),
      });
      count += 1;
    }
    return count;
  }

  async findMerchantByStripeCustomerId(
    customerId: string,
  ): Promise<string | undefined> {
    return [...this.billing.values()].find(
      (item) => item.stripeCustomerId === customerId,
    )?.merchantId;
  }

  async findMerchantByStripeSubscriptionId(
    subscriptionId: string,
  ): Promise<string | undefined> {
    return [...this.billing.values()].find(
      (item) => item.stripeSubscriptionId === subscriptionId,
    )?.merchantId;
  }

  async findMerchantByAsaasSubscriptionId(
    subscriptionId: string,
  ): Promise<string | undefined> {
    return [...this.billing.values()].find(
      (item) => item.asaasSubscriptionId === subscriptionId,
    )?.merchantId;
  }
}

function key(merchantId: string, provider: string): string {
  return `${merchantId.trim()}:${provider}`;
}
