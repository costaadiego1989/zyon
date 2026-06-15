import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { ApiKeyService } from "./domain/api-key.service.js";
import { ApiKeyAccessPolicy } from "./domain/api-key-access-policy.js";
import { WebhookSignatureService } from "./domain/webhook-signature.service.js";
import { INTEGRATIONS_REPOSITORY } from "./domain/ports/integrations.repository.port.js";
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
  RotateMerchantApiKeyUseCase,
  TenantWebhookPublisher,
  TestWebhookEndpointUseCase,
  UpdateTenantOrderTrackingUseCase,
  UpsertWebhookEndpointUseCase
} from "./application/integrations.use-cases.js";
import { WebhookDeliveryDispatcher } from "./application/webhook-delivery-dispatcher.service.js";
import { TenantWebhooksOnCheckoutHandler } from "./infrastructure/event-handlers/tenant-webhooks-on-checkout.handler.js";
import { IntegrationsController } from "./presentation/http/integrations.controller.js";
import { MerchantApiKeyGuard } from "./presentation/http/merchant-api-key.guard.js";
import { ApiKeyScopeGuard } from "./presentation/http/api-key-scope.guard.js";
import { TenantTrackingController } from "./presentation/http/tenant-tracking.controller.js";
import { AuthenticateMerchantApiKeyService } from "./application/authenticate-merchant-api-key.service.js";
import { TenantCredentialGuard } from "./presentation/http/tenant-credential.guard.js";
import { TenantAccessGuard } from "./presentation/http/tenant-access.guard.js";

@Module({
  imports: [AuthModule, CheckoutModule],
  controllers: [IntegrationsController, TenantTrackingController],
  providers: [
    ApiKeyService,
    ApiKeyAccessPolicy,
    AuthenticateMerchantApiKeyService,
    WebhookSignatureService,
    {
      provide: INTEGRATIONS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaIntegrationsRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    CreateMerchantApiKeyUseCase,
    ListMerchantApiKeysUseCase,
    RevokeMerchantApiKeyUseCase,
    RotateMerchantApiKeyUseCase,
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
    MerchantApiKeyGuard,
    ApiKeyScopeGuard,
    TenantCredentialGuard,
    TenantAccessGuard,
  ],
  exports: [
    INTEGRATIONS_REPOSITORY,
    ApiKeyService,
    ApiKeyAccessPolicy,
    AuthenticateMerchantApiKeyService,
    TenantCredentialGuard,
    TenantAccessGuard,
    TenantWebhookPublisher,
  ]
})
export class IntegrationsModule {}
