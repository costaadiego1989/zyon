import { PROSPECTING_PORTS } from "./domain/prospecting.ports.js";
import { CompanyDirectoryController } from "./presentation/company-directory.controller.js";
import { CompanyImportController } from "./presentation/company-import.controller.js";
import { ProspectController } from "./presentation/prospect.controller.js";
import { ProspectCampaignController } from "./presentation/prospect-campaign.controller.js";
import { ProspectConversationController } from "./presentation/prospect-conversation.controller.js";
import {
  ProspectKnowledgeController,
  KNOWLEDGE_ADMIN,
} from "./presentation/prospect-knowledge.controller.js";
import { ProspectPrivacyController } from "./presentation/prospect-privacy.controller.js";
import { ProspectSegmentController } from "./presentation/prospect-segment.controller.js";
import { ProspectSenderController } from "./presentation/prospect-sender.controller.js";
import {
  ProspectMetricsController,
  ProspectOperationalStatus,
} from "./presentation/prospect-metrics.controller.js";
import { ProspectConversionHistoryQuery } from "./application/billing/prospect-conversion-history.query.js";
import {
  ProspectConversionController,
  ProspectAccountBindingController,
  ProspectBillingProposalController,
} from "./presentation/prospect-billing.controller.js";
import { ProspectConversationGateway } from "./presentation/prospect-conversation.gateway.js";
import { SearchCompaniesQuery } from "./application/company-directory/search-companies.query.js";
import { CompanyImportService } from "./application/company-directory/company-import.service.js";
import { ProspectService } from "./application/crm/prospect.service.js";
import { ProspectMetricsQueryService } from "./application/crm/prospect-metrics.query.js";
import { ProspectConversationService } from "./application/conversations/prospect-conversation.service.js";
import { CampaignService } from "./application/campaigns/campaign.service.js";
import { FreezeCampaignAudience } from "./application/campaigns/freeze-campaign-audience.js";
import { SenderReadinessService } from "./application/campaigns/sender-readiness.service.js";
import { PlatformSenderOnboardingService } from "./application/campaigns/platform-sender-onboarding.service.js";
import {
  Controller,
  Get,
  Global,
  Module,
  UseGuards,
  type DynamicModule,
  type InjectionToken,
  type Provider,
} from "@nestjs/common";
import { PlatformControlModule } from "../platform-control/platform-control.module.js";
import { PlatformAccessGuard } from "../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../platform-control/presentation/platform-permission.decorator.js";
import { PROSPECT_META_DISPATCH } from "../../shared/integrations/prospect-meta-dispatch.port.js";
import { SUBSCRIPTION_ATTRIBUTION } from "../payment/domain/ports/subscription-attribution.port.js";
import {
  createProspectingRuntime,
  type ProspectingRuntime,
} from "./infrastructure/prospecting-runtime.js";
import { loadProspectingConfig } from "./infrastructure/prospecting-config.js";

@Controller("platform/prospecting")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
class DisabledProspectingController {
  @Get("config") config() {
    return {
      moduleEnabled: false,
      workersRunning: false,
      dispatchMode: "disabled",
      modelMode: "disabled",
      ingestionEnabled: false,
      reservationDayTimezone: "UTC",
    };
  }
}
export const PROSPECTING_RUNTIME = Symbol("ProspectingRuntime");
const expose = (
  provide: InjectionToken,
  key: keyof ProspectingRuntime
): Provider => ({
  provide,
  inject: [PROSPECTING_RUNTIME],
  useFactory: (runtime: ProspectingRuntime) => runtime[key],
});

@Global()
@Module({})
export class PlatformProspectingModule {
  static register(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const base = {
      module: PlatformProspectingModule,
      imports: [PlatformControlModule],
    };
    if (!loadProspectingConfig(env).enabled)
      return { ...base, controllers: [DisabledProspectingController] };
    return {
      ...base,
      controllers: [
        CompanyDirectoryController,
        CompanyImportController,
        ProspectSegmentController,
        ProspectController,
        ProspectPrivacyController,
        ProspectCampaignController,
        ProspectSenderController,
        ProspectKnowledgeController,
        ProspectConversationController,
        ProspectMetricsController,
        ProspectBillingProposalController,
        ProspectAccountBindingController,
        ProspectConversionController,
      ],
      providers: [
        {
          provide: PROSPECTING_RUNTIME,
          useFactory: () => createProspectingRuntime(env),
        },
        expose(PROSPECTING_PORTS.directory, "directory"),
        expose(PROSPECTING_PORTS.prospects, "crm"),
        expose(PROSPECTING_PORTS.privacy, "privacy"),
        expose(PROSPECTING_PORTS.segments, "segments"),
        expose(PROSPECTING_PORTS.campaigns, "reservations"),
        expose(PROSPECTING_PORTS.sender, "sender"),
        expose(PROSPECTING_PORTS.conversations, "history"),
        expose(PROSPECTING_PORTS.knowledge, "query"),
        expose(PROSPECTING_PORTS.llm, "llm"),
        expose(PROSPECTING_PORTS.offers, "offers"),
        expose(PROSPECTING_PORTS.billing, "bridge"),
        expose(PROSPECT_META_DISPATCH, "inbox"),
        {
          provide: SUBSCRIPTION_ATTRIBUTION,
          useExisting: PROSPECTING_PORTS.billing,
        },
        {
          provide: PROSPECTING_PORTS.inbox,
          useExisting: PROSPECT_META_DISPATCH,
        },
        expose(SearchCompaniesQuery, "search"),
        expose(CompanyImportService, "importService"),
        expose(ProspectService, "prospects"),
        expose(CampaignService, "campaign"),
        expose(FreezeCampaignAudience, "audience"),
        expose(SenderReadinessService, "health"),
        expose(PlatformSenderOnboardingService, "onboarding"),
        expose(ProspectConversationService, "conversation"),
        expose(ProspectConversionHistoryQuery, "conversions"),
        expose(ProspectMetricsQueryService, "metrics"),
        expose(ProspectOperationalStatus, "status"),
        {
          provide: KNOWLEDGE_ADMIN,
          inject: [PROSPECTING_RUNTIME],
          useFactory: ({
            sources,
            publications,
            query,
          }: ProspectingRuntime) => ({ sources, publications, query }),
        },
        ProspectConversationGateway,
      ],
      exports: [
        PROSPECT_META_DISPATCH,
        PROSPECTING_PORTS.billing,
        SUBSCRIPTION_ATTRIBUTION,
      ],
    };
  }
}

export const platformProspectingModule = PlatformProspectingModule.register();
