import type { PrismaClient } from "@prisma/client";
import type { S3UploadService } from "../../../shared/storage/s3-upload.service.js";
import type { ProductRepositoryPort } from "../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { MerchantStoreRepository } from '../../merchant/domain/ports/merchant-store.repository.port.js';
import type { MerchantAssistantIntegrationPort } from '../../merchant-assistant/application/assistant-integration.port.js';
import type { PaymentPlatformRepository } from "../../payment/domain/ports/payment-platform-repository.port.js";
import type { WhatsAppConfigRepository } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { readOffer, type MetaAdsEnvironment } from "../domain/offer.js";
import { MetaAdsError, type AttributionSessionBindingPort, type Clock, type RecommendationPort } from "../domain/types.js";
import { PrismaMetaAdsRepository } from "./prisma-meta-ads.repository.js";
import { CommerceContextAdapter } from "./commerce-context.adapter.js";
import { CredentialCodec } from "./credential-codec.js";
import { MetaOAuthAdapter } from "./meta-oauth.adapter.js";
import { MetaMcpAdapter } from "./meta-mcp.adapter.js";
import { CreativeReviewAdapter } from "./creative-review.adapter.js";
import { ImageGenerationAdapter } from "./image-generation.adapter.js";
import { StripeAddonAdapter } from "./stripe-addon.adapter.js";
import { ConversionsApiAdapter } from "./conversions-api.adapter.js";
import { GovernedRecommendationAdapter } from "./recommendation.adapter.js";
import { MetaFundingAdapter } from './meta-funding.adapter.js';
import { MetaBudgetControlAdapter } from './meta-budget-control.adapter.js';
import { PrismaDailyObservationRepository } from './prisma-daily-observation.repository.js';
import { DailyObservationEngine } from './daily-observation.engine.js';
import { AutomaticCampaignWorker } from './automatic-campaign.worker.js';
import { FundingService } from '../application/funding.service.js';
import { AutomationPolicyService } from '../application/automation-policy.service.js';
import { ExposureReservationService } from '../application/exposure-reservation.service.js';
import { ExecutionAuthorityService } from '../application/execution-authority.service.js';
import { MetaAdsAssistantAdapter } from '../application/meta-ads-assistant.adapter.js';
import { GenerationWorker } from "./generation.worker.js";
import { ObservationWorker } from "./observation.worker.js";
import { BillingService } from "../application/billing.service.js";
import { ConnectionService } from "../application/connection.service.js";
import { CampaignService } from "../application/campaign.service.js";
import { GenerationService } from "../application/generation.service.js";
import { ProposalService } from "../application/proposal.service.js";
import { ExecutionService } from "../application/execution.service.js";
import { AttributionService } from "../application/attribution.service.js";
import { MetaAdsAgentService } from "../application/meta-ads-agent.service.js";
import type { DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { CheckoutPurchaseBridge } from "./checkout-purchase.bridge.js";

/** Production composition has no memory repository or substitute provider path. */
export function createMetaAdsRuntime(input: { prisma: PrismaClient; catalog: ProductRepositoryPort; merchants: MerchantRepository; billing: PaymentPlatformRepository;
  storage: Pick<S3UploadService, "isConfigured" | "upload">; whatsapp: WhatsAppConfigRepository; env: MetaAdsEnvironment; events?: DomainEventBus; sessionBinding?: AttributionSessionBindingPort;
  assistant?: MerchantAssistantIntegrationPort; memberships?: Pick<MerchantStoreRepository, 'findMembership'>; request?: typeof fetch; clock?: Clock }) {
  const { env } = input; const repo = new PrismaMetaAdsRepository(input.prisma);
  const clock = input.clock ?? (() => new Date()), request = input.request ?? fetch;
  const commerce = new CommerceContextAdapter(input.prisma, input.catalog, input.merchants, input.billing, env, clock);
  let attribution: AttributionService;
  const provider = new MetaMcpAdapter(env, request, (merchantId, campaignId, original) => attribution.trackedUrl(merchantId, campaignId, original));
  const connection = new ConnectionService(repo, commerce, new MetaOAuthAdapter(env), new CredentialCodec(env.META_ADS_CREDENTIAL_ENCRYPTION_KEY), provider, env.META_ADS_OAUTH_REDIRECT_URI ?? "", clock);
  const billing = new BillingService(repo, commerce, new StripeAddonAdapter(env), () => readOffer(env), clock);
  const campaigns = new CampaignService(repo, commerce, connection, provider, clock);
  const generations = new GenerationService(repo, commerce, new ImageGenerationAdapter(env, input.storage, request, new CreativeReviewAdapter(env)), clock);
  const proposals = new ProposalService(repo, commerce, campaigns, connection, provider, clock);
  const automationEnabled = () => env.META_ADS_AGENT_ENABLED === 'true' && env.META_ADS_AGENT_AUTOMATION_ENABLED === 'true';
  const authorizeActor = async (merchantId: string, actorId: string) => {
    const member = await input.memberships?.findMembership(actorId, merchantId);
    if (!member || member.merchantId !== merchantId || !['owner', 'admin'].includes(member.role)) throw new MetaAdsError('meta_ads_role_forbidden', 403);
  };
  const funding = new FundingService(repo, billing, connection, new MetaFundingAdapter({ graphVersion: env.META_ADS_GRAPH_API_VERSION ?? '', request, clock }), clock);
  const budgetControl = new MetaBudgetControlAdapter({ request, clock });
  const policies = new AutomationPolicyService({ repo, commerce, connection, campaigns, authorizeActor, enabled: automationEnabled, clock });
  const exposure = new ExposureReservationService({ repo, commerce, enabled: automationEnabled, clock });
  const authority = new ExecutionAuthorityService({ repo, commerce, connection, campaigns, policies, exposure, budgetControl, funding, authorizeActor, enabled: automationEnabled, clock });
  const executions = new ExecutionService(repo, commerce, campaigns, connection, provider, clock, undefined, { authority, exposure, budgetControl });
  const automatic = new AutomaticCampaignWorker({ repo, policies, campaigns, generations, proposals, executions, enabled: automationEnabled, authorizeActor, clock });
  const conversions = new ConversionsApiAdapter(env, request, { get: async merchantId => {
    const config = await input.whatsapp.findByMerchantId(merchantId); const credentials = connectedMetaCloudCredentials(config, merchantId);
    const phoneNumber = config?.whatsappNumber ?? config?.phoneNumber;
    return credentials && phoneNumber ? { ...credentials, merchantId, phoneNumber } : null;
  } });
  attribution = new AttributionService(repo, commerce, connection, conversions, env.META_ADS_ATTRIBUTION_SIGNING_KEY, clock);
  const service = new MetaAdsAgentService(repo, commerce, billing, connection, campaigns, generations, proposals, executions, provider, env);
  const enabled = env.META_ADS_AGENT_ENABLED === "true";
  if (enabled && env.META_ADS_AGENT_PURCHASE_BRIDGE_ENABLED === "true" && !input.sessionBinding) throw new Error("meta_ads_checkout_binding_missing");
  if (enabled && env.META_ADS_AGENT_OBSERVATION_ENABLED === 'true' && !input.assistant) throw new Error('meta_ads_daily_gateway_missing');
  const daily = new PrismaDailyObservationRepository(input.prisma, clock);
  const analysis: RecommendationPort = input.assistant ? new GovernedRecommendationAdapter(input.assistant.createDailyAnalysis(async merchantId => {
    if (env.META_ADS_AGENT_ENABLED !== 'true' || env.META_ADS_AGENT_OBSERVATION_ENABLED !== 'true') throw new MetaAdsError('meta_ads_daily_analysis_disabled', 503);
    await billing.requireAccess(merchantId); await connection.access(merchantId);
  })) : { configured: () => false, recommend: async () => ({ recommendations: [], usage: null }) };
  const dailyEngine = new DailyObservationEngine({ repo, daily, commerce, connection, provider, timezone: access => provider.accountTimezone(access), attribution, recommendations: analysis, billing, automatic, clock });
  if (input.assistant) {
    const assistant = input.assistant;
    assistant.contexts.register(new MetaAdsAssistantAdapter({ service, conversations: assistant.repo, authorizeActor: assistant.authorizeActor, authorizeTool: assistant.authorizeTool,
      enabled: () => env.META_ADS_AGENT_ENABLED === 'true' && env.MERCHANT_ASSISTANT_ENABLED === 'true', clock,
      funding: merchantId => funding.describe(merchantId), reviewAutomation: (merchantId, terms, actorId) => policies.review(merchantId, actorId, terms),
      dailyReports: async (merchantId, localDay) => {
        const accountId = (await repo.read(merchantId)).connection.account?.id; if (!accountId) return [];
        const reports = (await daily.list(merchantId, accountId)).flatMap(row => row.report && (!localDay || row.localDay === localDay) ? [row.report] : []);
        return reports.slice(0, 1);
      },
      executeProposal: async (merchantId, proposalId, actorId) => {
        const proposal = (await repo.read(merchantId)).proposals[proposalId];
        if (proposal && !proposal.approvedBy && (await policies.view(merchantId)).mode === 'automatic') {
          const result = await automatic.processProposal(merchantId, proposalId);
          if (!result.executionId) throw new MetaAdsError('approval_required', 403);
          return (await repo.read(merchantId)).executions[result.executionId];
        }
        return executions.execute(merchantId, proposalId, actorId);
      },
      campaignSaved: async (scope, campaign, preference) => {
        if (preference !== 'automatic' || campaign.remoteCampaignId) return;
        const view = await policies.view(scope.merchantId);
        if (view.mode === 'automatic' && view.policy?.scope.allowNewCampaigns && !view.policy.scope.campaignIds.includes(campaign.id)) await automatic.bindCampaign(scope.merchantId, campaign.id, view.policy.id);
      } }));
  }
  return { service, attribution, funding, policies, exposure, authority, automatic, daily, dailyEngine, analysis,
    generationWorker: new GenerationWorker(repo, generations, enabled && env.META_ADS_AGENT_GENERATION_WORKER_ENABLED === "true", clock),
    purchaseBridge: new CheckoutPurchaseBridge(repo, commerce, attribution, input.events, enabled && env.META_ADS_AGENT_PURCHASE_BRIDGE_ENABLED === "true", undefined, input.sessionBinding),
    observation: new ObservationWorker(repo, commerce, connection, provider, attribution, analysis, billing, { enabled: enabled && env.META_ADS_AGENT_OBSERVATION_ENABLED === "true" }, clock, dailyEngine) };
}
export type MetaAdsRuntime = ReturnType<typeof createMetaAdsRuntime>;
