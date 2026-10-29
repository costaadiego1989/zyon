import type { AcpWebhookSubscriptionEntity } from "./acp-webhook-subscription.entity.js";

export const ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY = Symbol(
  "ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY",
);

export interface AcpWebhookSubscriptionRepository {
  save(subscription: AcpWebhookSubscriptionEntity): Promise<AcpWebhookSubscriptionEntity>;
  listByMerchant(merchantId: string): Promise<AcpWebhookSubscriptionEntity[]>;
  findById(
    merchantId: string,
    id: string,
  ): Promise<AcpWebhookSubscriptionEntity | undefined>;
  delete(merchantId: string, id: string): Promise<boolean>;
}
