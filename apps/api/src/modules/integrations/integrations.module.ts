import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { WebhookSignatureService } from "./domain/webhook-signature.service.js";
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
import { TenantAccessModule } from "./tenant-access.module.js";

@Module({
  imports: [AuthModule, CheckoutModule, TenantAccessModule],
  controllers: [IntegrationsController, TenantTrackingController],
  providers: [
    WebhookSignatureService,
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
  ],
  exports: [
    TenantAccessModule,
    TenantWebhookPublisher,
  ]
})
export class IntegrationsModule {}
