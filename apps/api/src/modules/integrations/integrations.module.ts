import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutPersistenceModule } from "../checkout/checkout-persistence.module.js";
import { CheckoutOrderTrackingModule } from "../checkout/checkout-order-tracking.module.js";
import { WebhookSignatureService } from "./domain/webhook-signature.service.js";
import {
  CreateMerchantApiKeyUseCase,
  DeleteWebhookEndpointUseCase,
  GetTrackingTimelineUseCase,
  GetWebhookDeliveryUseCase,
  GetWebhookEndpointUseCase,
  ListMerchantApiKeysUseCase,
  ListTenantShipmentsUseCase,
  ListWebhookDeliveriesUseCase,
  ListWebhookEndpointsUseCase,
  ReplayWebhookDeliveryUseCase,
  RevokeMerchantApiKeyUseCase,
  RotateMerchantApiKeyUseCase,
  RotateWebhookSigningSecretUseCase,
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
import { WebhookEndpointsController } from "./presentation/http/webhook-endpoints.controller.js";
import { WEBHOOK_TARGET_POLICY } from "./domain/ports/webhook-target-policy.port.js";
import { DnsWebhookTargetPolicy } from "./infrastructure/dns-webhook-target-policy.js";
import {
  WEBHOOK_DISPATCHER_CONFIG,
  createWebhookDispatcherConfig
} from "./domain/webhook-dispatcher.config.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

@Module({
  imports: [AuthModule, CheckoutPersistenceModule, CheckoutOrderTrackingModule, TenantAccessModule],
  controllers: [
    IntegrationsController,
    TenantTrackingController,
    WebhookEndpointsController,
  ],
  providers: [
    WebhookSignatureService,
    {
      provide: WEBHOOK_TARGET_POLICY,
      useClass: DnsWebhookTargetPolicy,
    },
    CreateMerchantApiKeyUseCase,
    ListMerchantApiKeysUseCase,
    RevokeMerchantApiKeyUseCase,
    RotateMerchantApiKeyUseCase,
    UpsertWebhookEndpointUseCase,
    DeleteWebhookEndpointUseCase,
    ListWebhookEndpointsUseCase,
    GetWebhookEndpointUseCase,
    RotateWebhookSigningSecretUseCase,
    TenantWebhookPublisher,
    ListWebhookDeliveriesUseCase,
    GetWebhookDeliveryUseCase,
    ReplayWebhookDeliveryUseCase,
    TestWebhookEndpointUseCase,
    UpdateTenantOrderTrackingUseCase,
    ListTenantShipmentsUseCase,
    GetTrackingTimelineUseCase,
    WebhookDeliveryDispatcher,
    TenantWebhooksOnCheckoutHandler,
    MerchantApiKeyGuard,
    ApiKeyScopeGuard,
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: WEBHOOK_DISPATCHER_CONFIG,
      useFactory: () => createWebhookDispatcherConfig()
    },
  ],
  exports: [
    TenantAccessModule,
    TenantWebhookPublisher,
    WebhookDeliveryDispatcher,
    UpdateTenantOrderTrackingUseCase,
    ListWebhookEndpointsUseCase,
    GetWebhookEndpointUseCase,
    DeleteWebhookEndpointUseCase,
    UpsertWebhookEndpointUseCase,
    TestWebhookEndpointUseCase,
    ListWebhookDeliveriesUseCase,
  ]
})
export class IntegrationsModule {}
