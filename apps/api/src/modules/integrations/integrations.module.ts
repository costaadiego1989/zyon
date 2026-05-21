import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { ApiKeyService } from "./domain/api-key.service.js";
import { WebhookSignatureService } from "./domain/webhook-signature.service.js";
import { INTEGRATIONS_REPOSITORY } from "./domain/ports/integrations.repository.port.js";
import { InMemoryIntegrationsRepository } from "./infrastructure/in-memory-integrations.repository.js";
import { PrismaIntegrationsRepository } from "./infrastructure/prisma-integrations.repository.js";
import {
  CreateMerchantApiKeyUseCase,
  GetTrackingTimelineUseCase,
  ListMerchantApiKeysUseCase,
  ListTenantShipmentsUseCase,
  ListWebhookDeliveriesUseCase,
  ListWebhookEndpointsUseCase,
  ReplayWebhookDeliveryUseCase,
  RevokeMerchantApiKeyUseCase,
  TenantWebhookPublisher,
  TestWebhookEndpointUseCase,
  UpdateTenantOrderTrackingUseCase,
  UpsertWebhookEndpointUseCase
} from "./application/integrations.use-cases.js";
import { WebhookDeliveryDispatcher } from "./application/webhook-delivery-dispatcher.service.js";
import { TenantWebhooksOnCheckoutHandler } from "./infrastructure/event-handlers/tenant-webhooks-on-checkout.handler.js";
import { IntegrationsController } from "./presentation/http/integrations.controller.js";
import { MerchantApiKeyGuard } from "./presentation/http/merchant-api-key.guard.js";
import { TenantTrackingController } from "./presentation/http/tenant-tracking.controller.js";

@Module({
  imports: [AuthModule, CheckoutModule],
  controllers: [IntegrationsController, TenantTrackingController],
  providers: [
    ApiKeyService,
    WebhookSignatureService,
    InMemoryIntegrationsRepository,
    {
      provide: INTEGRATIONS_REPOSITORY,
      useFactory: (memory: InMemoryIntegrationsRepository, prisma: PrismaClient) => {
        if (process.env.CHECKOUT_REPOSITORY === "prisma" || process.env.INTEGRATIONS_REPOSITORY === "prisma") {
          return new PrismaIntegrationsRepository(prisma);
        }
        return memory;
      },
      inject: [InMemoryIntegrationsRepository, PRISMA_CLIENT]
    },
    CreateMerchantApiKeyUseCase,
    ListMerchantApiKeysUseCase,
    RevokeMerchantApiKeyUseCase,
    UpsertWebhookEndpointUseCase,
    ListWebhookEndpointsUseCase,
    TenantWebhookPublisher,
    ListWebhookDeliveriesUseCase,
    ReplayWebhookDeliveryUseCase,
    TestWebhookEndpointUseCase,
    UpdateTenantOrderTrackingUseCase,
    ListTenantShipmentsUseCase,
    GetTrackingTimelineUseCase,
    WebhookDeliveryDispatcher,
    TenantWebhooksOnCheckoutHandler,
    MerchantApiKeyGuard
  ],
  exports: [INTEGRATIONS_REPOSITORY, ApiKeyService, TenantWebhookPublisher]
})
export class IntegrationsModule {}
