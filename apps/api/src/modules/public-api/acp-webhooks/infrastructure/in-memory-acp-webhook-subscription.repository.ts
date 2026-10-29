import { Injectable } from "@nestjs/common";
import type { AcpWebhookSubscriptionEntity } from "../domain/acp-webhook-subscription.entity.js";
import {
  ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type AcpWebhookSubscriptionRepository,
} from "../domain/acp-webhook-subscription.repository.port.js";

/**
 * In-memory ACP webhook subscription store.
 *
 * Per ADR-025 Phase 3, persistence is intentionally minimal — Prisma
 * persistence is wired later. Subscriptions are keyed by merchant id so
 * cross-tenant reads are blocked at the storage layer. Single-process only;
 * restarts wipe the registry (acceptable during the adapter rollout).
 */
@Injectable()
export class InMemoryAcpWebhookSubscriptionRepository
  implements AcpWebhookSubscriptionRepository
{
  private readonly byMerchant = new Map<string, Map<string, AcpWebhookSubscriptionEntity>>();

  async save(
    subscription: AcpWebhookSubscriptionEntity,
  ): Promise<AcpWebhookSubscriptionEntity> {
    const scoped = this.scoped(subscription.merchantId);
    scoped.set(subscription.id, subscription);
    return subscription;
  }

  async listByMerchant(merchantId: string): Promise<AcpWebhookSubscriptionEntity[]> {
    const scoped = this.scoped(merchantId);
    return Array.from(scoped.values());
  }

  async findById(
    merchantId: string,
    id: string,
  ): Promise<AcpWebhookSubscriptionEntity | undefined> {
    return this.scoped(merchantId).get(id);
  }

  async delete(merchantId: string, id: string): Promise<boolean> {
    const scoped = this.scoped(merchantId);
    return scoped.delete(id);
  }

  private scoped(merchantId: string): Map<string, AcpWebhookSubscriptionEntity> {
    let bucket = this.byMerchant.get(merchantId);
    if (!bucket) {
      bucket = new Map();
      this.byMerchant.set(merchantId, bucket);
    }
    return bucket;
  }
}

export const ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY_PROVIDER = {
  provide: ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY,
  useClass: InMemoryAcpWebhookSubscriptionRepository,
};
