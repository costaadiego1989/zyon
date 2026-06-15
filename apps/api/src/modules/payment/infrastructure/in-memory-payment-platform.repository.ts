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

  async getOrCreateTrial(
    merchantId: string,
    trialDays: number,
  ): Promise<BillingSubscriptionSnapshot> {
    const existing = this.billing.get(merchantId);
    if (existing) return existing;
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
    this.billing.set(input.merchantId, {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    });
  }

  async getBilling(
    merchantId: string,
  ): Promise<BillingSubscriptionSnapshot | undefined> {
    return this.billing.get(merchantId);
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
}

function key(merchantId: string, provider: string): string {
  return `${merchantId.trim()}:${provider}`;
}
