import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { StorageModule } from "../../shared/storage/storage.module.js";
import { S3UploadService } from "../../shared/storage/s3-upload.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import type { ProductRepositoryPort } from "../catalog/domain/ports/product-repository.port.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../merchant/domain/ports/merchant-repository.port.js";
import { MERCHANT_STORE_REPOSITORY, type MerchantStoreRepository } from '../merchant/domain/ports/merchant-store.repository.port.js';
import { MerchantAssistantModule, MERCHANT_ASSISTANT_RUNTIME } from '../merchant-assistant/merchant-assistant.module.js';
import type { MerchantAssistantRuntime } from '../merchant-assistant/infrastructure/runtime.js';
import { PaymentModule } from "../payment/payment.module.js";
import { PAYMENT_PLATFORM_REPOSITORY, type PaymentPlatformRepository } from "../payment/domain/ports/payment-platform-repository.port.js";
import { WhatsAppConfigModule } from "../whatsapp-channel/whatsapp-config.module.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { MetaAdsAgentService } from "./application/meta-ads-agent.service.js";
import { AttributionService } from "./application/attribution.service.js";
import { createMetaAdsRuntime, type MetaAdsRuntime } from "./infrastructure/runtime.js";
import { GenerationWorker } from "./infrastructure/generation.worker.js";
import { ObservationWorker } from "./infrastructure/observation.worker.js";
import { MetaAdsAgentController, MetaAdsHttpErrorFilter } from "./presentation/meta-ads-agent.controller.js";
import { StripeAddonWebhookController } from "./presentation/stripe-addon-webhook.controller.js";
import { MessagingModule } from "../../shared/messaging/messaging.module.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../shared/events/domain-event-bus.port.js";
import { CheckoutPurchaseBridge } from "./infrastructure/checkout-purchase.bridge.js";
import { CheckoutPersistenceModule } from "../checkout/checkout-persistence.module.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../checkout/domain/ports/checkout-session.repository.port.js";
import { META_ADS_SESSION_BINDING, type AttributionSessionBindingPort } from "./domain/types.js";
import { CheckoutSessionBindingAdapter } from "./infrastructure/checkout-session-binding.adapter.js";
import { RealtimeCapabilityService } from "../../shared/auth/realtime-capability.js";
import { AttributionController } from "./presentation/attribution.controller.js";
import { FundingController } from './presentation/funding.controller.js';
import { AutomationReportController } from './presentation/automation-report.controller.js';
import { FundingService } from './application/funding.service.js';
import { AutomationPolicyService } from './application/automation-policy.service.js';
import { AutomaticCampaignWorker } from './infrastructure/automatic-campaign.worker.js';
import { DAILY_OBSERVATION_REPOSITORY } from './domain/daily-observation.port.js';
import {CampaignApprovalController} from './presentation/campaign-approval.controller.js';
import {CampaignLifecycleController} from './presentation/campaign-lifecycle.controller.js';
import {CampaignLifecycleService} from './application/campaign-lifecycle.service.js';
import {CampaignWorkspaceController} from './presentation/campaign-workspace.controller.js';
import {CampaignWorkspaceQueryService} from './application/campaign-workspace-query.service.js';
import {CampaignPreparationService} from './application/campaign-preparation.service.js';
import {CampaignNoticeContactService} from './application/campaign-notice-contact.service.js';
import {InitialLaunchService} from './application/initial-launch.service.js';
import {CampaignPreparationWorker} from './infrastructure/campaign-preparation.worker.js';
import {CampaignReadyNoticeWorker} from './infrastructure/campaign-ready-notice.worker.js';
import {WhatsAppTemplatesModule} from '../whatsapp-templates/whatsapp-templates.module.js';
import {WHATSAPP_TEMPLATE_REPOSITORY,type WhatsAppTemplateRepositoryPort} from '../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js';
import {WHATSAPP_TEMPLATE_SENDER,type WhatsAppTemplateSenderPort} from '../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js';

const runtime = Symbol("MetaAdsRuntime");
@Module({
  imports: [PersistenceModule, StorageModule, AuthModule, CatalogModule, MerchantModule, PaymentModule, WhatsAppConfigModule, MessagingModule, CheckoutPersistenceModule, MerchantAssistantModule,WhatsAppTemplatesModule],
  controllers: [MetaAdsAgentController, StripeAddonWebhookController, AttributionController, FundingController, AutomationReportController,CampaignApprovalController,CampaignLifecycleController,CampaignWorkspaceController],
  providers: [
    { provide: META_ADS_SESSION_BINDING, useFactory: (sessions: CheckoutSessionRepository) => new CheckoutSessionBindingAdapter(sessions), inject: [CHECKOUT_SESSION_REPOSITORY] },
    { provide: RealtimeCapabilityService, useFactory: () => new RealtimeCapabilityService() },
    { provide: runtime, useFactory: (prisma: PrismaClient, catalog: ProductRepositoryPort, merchants: MerchantRepository, billing: PaymentPlatformRepository, storage: S3UploadService, whatsapp: WhatsAppConfigRepository, events: DomainEventBus, sessionBinding: AttributionSessionBindingPort, assistant: MerchantAssistantRuntime, memberships: MerchantStoreRepository,templates:WhatsAppTemplateRepositoryPort,templateSender:WhatsAppTemplateSenderPort) => createMetaAdsRuntime({ prisma, catalog, merchants, billing, storage, whatsapp, events, sessionBinding, assistant, memberships,templates,templateSender, env: process.env }), inject: [PRISMA_CLIENT, "ProductRepositoryPort", MERCHANT_REPOSITORY, PAYMENT_PLATFORM_REPOSITORY, S3UploadService, WHATSAPP_CONFIG_REPOSITORY, DOMAIN_EVENT_BUS, META_ADS_SESSION_BINDING, MERCHANT_ASSISTANT_RUNTIME, MERCHANT_STORE_REPOSITORY,WHATSAPP_TEMPLATE_REPOSITORY,WHATSAPP_TEMPLATE_SENDER] },
    { provide: MetaAdsAgentService, useFactory: (value: MetaAdsRuntime) => value.service, inject: [runtime] },
    { provide: AttributionService, useFactory: (value: MetaAdsRuntime) => value.attribution, inject: [runtime] },
    { provide: GenerationWorker, useFactory: (value: MetaAdsRuntime) => value.generationWorker, inject: [runtime] },
    { provide: ObservationWorker, useFactory: (value: MetaAdsRuntime) => value.observation, inject: [runtime] },
    { provide: FundingService, useFactory: (value: MetaAdsRuntime) => value.funding, inject: [runtime] },
    { provide: AutomationPolicyService, useFactory: (value: MetaAdsRuntime) => value.policies, inject: [runtime] },
    { provide: DAILY_OBSERVATION_REPOSITORY, useFactory: (value: MetaAdsRuntime) => value.daily, inject: [runtime] },
    { provide: AutomaticCampaignWorker, useFactory: (value: MetaAdsRuntime) => value.automatic, inject: [runtime] },
    {provide:CampaignPreparationService,useFactory:(value:MetaAdsRuntime)=>value.preparation,inject:[runtime]},
    {provide:CampaignLifecycleService,useFactory:(value:MetaAdsRuntime)=>value.lifecycle,inject:[runtime]},
    {provide:CampaignWorkspaceQueryService,useFactory:(value:MetaAdsRuntime)=>value.workspace,inject:[runtime]},
    {provide:CampaignNoticeContactService,useFactory:(value:MetaAdsRuntime)=>value.contacts,inject:[runtime]},
    {provide:InitialLaunchService,useFactory:(value:MetaAdsRuntime)=>value.launches,inject:[runtime]},
    {provide:CampaignPreparationWorker,useFactory:(value:MetaAdsRuntime)=>value.preparationWorker,inject:[runtime]},
    {provide:CampaignReadyNoticeWorker,useFactory:(value:MetaAdsRuntime)=>value.noticeWorker,inject:[runtime]},
    { provide: CheckoutPurchaseBridge, useFactory: (value: MetaAdsRuntime) => value.purchaseBridge, inject: [runtime] },
    MetaAdsHttpErrorFilter,
  ],
  exports: [MetaAdsAgentService, AttributionService],
})
export class MetaAdsAgentModule {}
