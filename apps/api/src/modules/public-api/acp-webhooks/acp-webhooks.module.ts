import { Module } from "@nestjs/common";
import {
  DeleteAcpWebhookSubscriptionUseCase,
  ListAcpWebhookSubscriptionsUseCase,
  PublishAcpOrderEventUseCase,
  RegisterAcpWebhookSubscriptionUseCase,
} from "./application/acp-webhook-subscription.use-cases.js";
import { AcpWebhookDispatcherService } from "./application/acp-webhook-dispatcher.service.js";
import {
  ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY_PROVIDER,
  InMemoryAcpWebhookSubscriptionRepository,
} from "./infrastructure/in-memory-acp-webhook-subscription.repository.js";
import { AcpWebhooksController } from "./presentation/acp-webhooks.controller.js";

@Module({
  controllers: [AcpWebhooksController],
  providers: [
    ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY_PROVIDER,
    InMemoryAcpWebhookSubscriptionRepository,
    AcpWebhookDispatcherService,
    RegisterAcpWebhookSubscriptionUseCase,
    ListAcpWebhookSubscriptionsUseCase,
    DeleteAcpWebhookSubscriptionUseCase,
    PublishAcpOrderEventUseCase,
  ],
  exports: [
    AcpWebhookDispatcherService,
    RegisterAcpWebhookSubscriptionUseCase,
    ListAcpWebhookSubscriptionsUseCase,
    DeleteAcpWebhookSubscriptionUseCase,
    PublishAcpOrderEventUseCase,
  ],
})
export class AcpWebhooksModule {}
