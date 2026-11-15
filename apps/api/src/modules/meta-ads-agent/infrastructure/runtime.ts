import type { PrismaClient } from "@prisma/client";
import type { S3UploadService } from "../../../shared/storage/s3-upload.service.js";
import type { ProductRepositoryPort } from "../../catalog/domain/ports/product-repository.port.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { PaymentPlatformRepository } from "../../payment/domain/ports/payment-platform-repository.port.js";
import type { WhatsAppConfigRepository } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js";
import { readOffer, type MetaAdsEnvironment } from "../domain/offer.js";
import type { AttributionSessionBindingPort } from "../domain/types.js";
import { PrismaMetaAdsRepository } from "./prisma-meta-ads.repository.js";
import { CommerceContextAdapter } from "./commerce-context.adapter.js";
import { CredentialCodec } from "./credential-codec.js";
import { MetaOAuthAdapter } from "./meta-oauth.adapter.js";
import { MetaMcpAdapter } from "./meta-mcp.adapter.js";
import { CreativeReviewAdapter } from "./creative-review.adapter.js";
import { ImageGenerationAdapter } from "./image-generation.adapter.js";
import { StripeAddonAdapter } from "./stripe-addon.adapter.js";
import { ConversionsApiAdapter } from "./conversions-api.adapter.js";
import { RecommendationAdapter } from "./recommendation.adapter.js";
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
  storage: Pick<S3UploadService, "isConfigured" | "upload">; whatsapp: WhatsAppConfigRepository; env: MetaAdsEnvironment; events?: DomainEventBus; sessionBinding?: AttributionSessionBindingPort }) {
  const { env } = input; const repo = new PrismaMetaAdsRepository(input.prisma);
  const commerce = new CommerceContextAdapter(input.prisma, input.catalog, input.merchants, input.billing, env);
  let attribution: AttributionService;
  const provider = new MetaMcpAdapter(env, fetch, (merchantId, campaignId, original) => attribution.trackedUrl(merchantId, campaignId, original));
  const connection = new ConnectionService(repo, commerce, new MetaOAuthAdapter(env), new CredentialCodec(env.META_ADS_CREDENTIAL_ENCRYPTION_KEY), provider, env.META_ADS_OAUTH_REDIRECT_URI ?? "");
  const billing = new BillingService(repo, commerce, new StripeAddonAdapter(env), () => readOffer(env));
  const campaigns = new CampaignService(repo, commerce, connection, provider);
  const generations = new GenerationService(repo, commerce, new ImageGenerationAdapter(env, input.storage, fetch, new CreativeReviewAdapter(env)));
  const proposals = new ProposalService(repo, commerce, campaigns, connection, provider);
  const executions = new ExecutionService(repo, commerce, campaigns, connection, provider);
  const conversions = new ConversionsApiAdapter(env, fetch, { get: async merchantId => {
    const config = await input.whatsapp.findByMerchantId(merchantId); const credentials = connectedMetaCloudCredentials(config, merchantId);
    const phoneNumber = config?.whatsappNumber ?? config?.phoneNumber;
    return credentials && phoneNumber ? { ...credentials, merchantId, phoneNumber } : null;
  } });
  attribution = new AttributionService(repo, commerce, connection, conversions, env.META_ADS_ATTRIBUTION_SIGNING_KEY);
  const service = new MetaAdsAgentService(repo, commerce, billing, connection, campaigns, generations, proposals, executions, provider, env);
  const enabled = env.META_ADS_AGENT_ENABLED === "true";
  if (enabled && env.META_ADS_AGENT_PURCHASE_BRIDGE_ENABLED === "true" && !input.sessionBinding) throw new Error("meta_ads_checkout_binding_missing");
  return { service, attribution, generationWorker: new GenerationWorker(repo, generations, enabled && env.META_ADS_AGENT_GENERATION_WORKER_ENABLED === "true"),
    purchaseBridge: new CheckoutPurchaseBridge(repo, commerce, attribution, input.events, enabled && env.META_ADS_AGENT_PURCHASE_BRIDGE_ENABLED === "true", undefined, input.sessionBinding),
    observation: new ObservationWorker(repo, commerce, connection, provider, attribution, new RecommendationAdapter(env), billing, { enabled: enabled && env.META_ADS_AGENT_OBSERVATION_ENABLED === "true" }) };
}
export type MetaAdsRuntime = ReturnType<typeof createMetaAdsRuntime>;
