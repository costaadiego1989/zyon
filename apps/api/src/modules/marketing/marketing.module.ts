import { Global, Module } from "@nestjs/common";
import { StorefrontRelationshipModule } from "../storefront/relationship.public-api.js";
import { APP_FILTER } from "@nestjs/core";
import { BuyerRelationshipModule } from "../buyer-account/relationship.public-api.js";
import { CampaignConsentReadModule } from "../campaign-consent/public-api.js";
import { CheckoutRelationshipModule } from "../checkout/relationship.public-api.js";
import { PaymentRelationshipModule } from "../payment/relationship.public-api.js";
import { AiUsageRecordingModule } from "../ai-usage/module.public-api.js";
import { MerchantMarketingMessagingModule } from "../whatsapp-channel/marketing.public-api.js";
import { MARKETING_RELATIONSHIP } from "../../shared/contracts/marketing.js";
import { MARKETING_REPOSITORY } from "./domain/marketing.repository.js";
import { MARKETING_CLASSIFIER } from "./domain/marketing-classifier.port.js";
import {
  MARKETING_CONTEXT,
  MARKETING_CLOCK,
} from "./domain/marketing-context.port.js";
import { MarketingContactsService } from "./application/marketing-contacts.service.js";
import { MarketingConversationsService } from "./application/marketing-conversations.service.js";
import { MarketingCampaignsService } from "./application/marketing-campaigns.service.js";
import { MarketingLifecycleService } from "./application/marketing-lifecycle.service.js";
import { MarketingLifecycleWorker } from "./infrastructure/marketing-lifecycle.worker.js";
import { WhatsAppRelationshipHistoryModule } from "../whatsapp-channel/history.public-api.js";
import { PrismaMarketingRepository } from "./infrastructure/prisma-marketing.repository.js";
import { MarketingContextAdapter } from "./infrastructure/marketing-context.adapter.js";
import { MarketingInterestClassifier } from "./infrastructure/marketing-interest-classifier.js";
import { MarketingObservability } from "./infrastructure/marketing-observability.js";
import { MarketingEventsHandler } from "./infrastructure/marketing-events.handler.js";
import { MarketingCampaignWorker } from "./infrastructure/marketing-campaign.worker.js";
import { MarketingRelationshipAdapter } from "./infrastructure/marketing-relationship.adapter.js";
import { MarketingController } from "./presentation/marketing.controller.js";
import {
  MarketingExceptionFilter,
  MarketingHttpInterceptor,
  MarketingPlanGuard,
} from "./presentation/marketing-http.js";

/** Global registration exports only the stable channel contract. Domain state stays private. */
@Global()
@Module({
  imports: [
    StorefrontRelationshipModule,
    BuyerRelationshipModule,
    CheckoutRelationshipModule,
    PaymentRelationshipModule,
    CampaignConsentReadModule,
    AiUsageRecordingModule,
    MerchantMarketingMessagingModule,
    WhatsAppRelationshipHistoryModule,
  ],
  controllers: [MarketingController],
  providers: [
    { provide: MARKETING_REPOSITORY, useClass: PrismaMarketingRepository },
    { provide: MARKETING_CONTEXT, useClass: MarketingContextAdapter },
    { provide: MARKETING_CLOCK, useValue: { now: () => new Date() } },
    { provide: MARKETING_CLASSIFIER, useClass: MarketingInterestClassifier },
    MarketingContactsService,
    MarketingConversationsService,
    MarketingCampaignsService,
    MarketingEventsHandler,
    MarketingCampaignWorker,
    MarketingLifecycleService,
    MarketingLifecycleWorker,
    MarketingObservability,
    MarketingPlanGuard,
    MarketingExceptionFilter,
    MarketingHttpInterceptor,
    { provide: APP_FILTER, useClass: MarketingExceptionFilter },
    { provide: MARKETING_RELATIONSHIP, useClass: MarketingRelationshipAdapter },
  ],
  exports: [MARKETING_RELATIONSHIP, MerchantMarketingMessagingModule],
})
export class MarketingModule {}
