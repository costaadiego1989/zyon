/** Public acquisition contracts. Provider credentials never belong in these DTOs. */
export type MetaAdsDestination = "store" | "whatsapp";
export type MetaAdsPriority = "paid_sales" | "cost_per_purchase" | "roas" | "contribution";
export type MetaAdsActionKind = "prepare" | "publish" | "pause" | "budget" | "creative" | "audience";
export type MetaAdsProposalStatus = "pending_review" | "approved" | "rejected" | "stale" | "executed";
export type MetaAdsExecutionStatus = "reserved" | "sending" | "remote_draft" | "remote_paused" | "publishing" | "active_unconfirmed" | "delivered" | "failed" | "execution_unknown";
export type MetaAdsConnectionStatus = "disconnected" | "authorizing" | "connected" | "limited" | "reconnect_required";
export type MetaAdsGenerationStatus = "reserved" | "running" | "succeeded" | "partial" | "failed" | "unknown";

export interface MetaAdsOffer {
  version: string;
  monthlyPriceCents: number;
  currency: "BRL";
  cadence: "monthly";
  monthlyImageCredits: number;
  extraImageCredits: number;
  extraImagePriceCents: number;
  maxManagedCampaigns: number;
  commercialReady: boolean;
  unavailableReasons: string[];
}

export interface MetaAdsSubscription {
  id: string;
  offer: MetaAdsOffer;
  status: "checkout_pending" | "active" | "cancel_at_period_end" | "ended";
  provider: "stripe";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  acceptedAt: string;
}

export interface MetaAdsWallet {
  monthlyAvailable: number;
  extraAvailable: number;
  reserved: number;
  periodKey: string | null;
  periodEndsAt: string | null;
}

export interface MetaAdsAsset {
  id: string;
  name: string;
  accountId?: string;
  pageId?: string;
}

export interface MetaAdsConnection {
  status: MetaAdsConnectionStatus;
  epoch: number;
  account: MetaAdsAsset | null;
  page: MetaAdsAsset | null;
  catalog: MetaAdsAsset | null;
  dataset: MetaAdsAsset | null;
  whatsapp: MetaAdsAsset | null;
  accounts: MetaAdsAsset[];
  pages: MetaAdsAsset[];
  catalogs: MetaAdsAsset[];
  datasets: MetaAdsAsset[];
  whatsappNumbers: MetaAdsAsset[];
  capabilities: Record<string, boolean>;
  lastError: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  oauthConfigured: boolean;
}

export interface MetaAdsProduct {
  productId: string;
  variantId: string;
  name: string;
  description: string;
  sku: string;
  imageUrl: string | null;
  priceCents: number;
  currency: string;
  stockQuantity: number | null;
  active: boolean;
  storefrontUrl: string;
  commercialVersion: string;
}

export interface MetaAdsBudget {
  amountCents: number;
  currency: "BRL";
  cadence: "daily" | "lifetime";
  startsAt: string;
  endsAt: string | null;
}

export interface MetaAdsCampaignDraft {
  name: string;
  destination: MetaAdsDestination;
  priority: MetaAdsPriority;
  variantIds: string[];
  budget: MetaAdsBudget | null;
  mediaIds: string[];
  headline: string;
  primaryText: string;
  country: string;
}

export interface MetaAdsCampaign {
  id: string;
  draft: MetaAdsCampaignDraft;
  products: MetaAdsProduct[];
  createdByAgent: boolean;
  managed: boolean;
  remoteCampaignId: string | null;
  remoteAdSetId: string | null;
  remoteAdIds: string[];
  remoteAccountId?: string | null;
  remoteCreativeIds?: string[];
  status: "draft" | MetaAdsExecutionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MetaAdsMedia {
  id: string;
  campaignId: string;
  variantId: string;
  productId: string;
  url: string;
  productVersion: string;
  createdAt: string;
  commercialReview?: { status: "verified" | "rejected" | "unavailable"; productVersion: string; imageSha256: string };
}

export interface MetaAdsCampaignReadiness {
  campaign: MetaAdsCampaign;
  missingData: string[];
  missingSetup: string[];
  ready: boolean;
}

export interface MetaAdsGeneration {
  id: string;
  campaignId: string;
  requestedImages: number;
  status: MetaAdsGenerationStatus;
  mediaIds: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetaAdsProposal {
  id: string;
  campaignId: string;
  kind: MetaAdsActionKind;
  status: MetaAdsProposalStatus;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  digest: string;
  connectionEpoch: number;
  reasoning: string;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  executionId: string | null;
}

export interface MetaAdsExecution {
  id: string;
  proposalId: string;
  campaignId: string;
  status: MetaAdsExecutionStatus;
  objects: Array<{ type: "campaign" | "ad_set" | "ad" | "creative"; id: string }>;
  error: string | null;
  updatedAt: string;
}

export interface MetaAdsMetrics {
  campaignId: string;
  since: string;
  until: string;
  updatedAt: string;
  timezone: string;
  currency: string;
  attributionWindow: string;
  source: string;
  spendCents: number | null;
  attributedRevenueCents: number | null;
  confirmedRevenueCents: number | null;
  paidOrders: number;
  conversations: number;
  costPerPurchaseCents: number | null;
  roas: number | null;
  contributionCents: number | null;
  costCoverage: "complete" | "partial" | "unavailable";
  stale: boolean;
  notes: string[];
}

export interface MetaAdsRecommendation {
  id: string;
  campaignId: string;
  priority: MetaAdsPriority;
  hypothesis: string;
  evidence: Record<string, number | string | null>;
  proposedAction: MetaAdsActionKind | null;
  proposedFields: Record<string, unknown>;
  status: "awaiting_data" | "pending_review" | "rejected";
  createdAt: string;
}

export interface MetaAdsOverview {
  eligible: boolean;
  entitled: boolean;
  offer: MetaAdsOffer;
  subscription: MetaAdsSubscription | null;
  wallet: MetaAdsWallet;
  connection: MetaAdsConnection;
  campaigns: MetaAdsCampaign[];
  proposals: MetaAdsProposal[];
  executions: MetaAdsExecution[];
  generations: MetaAdsGeneration[];
  media: MetaAdsMedia[];
  metrics: MetaAdsMetrics[];
  recommendations: MetaAdsRecommendation[];
}

export interface MetaAdsCheckout {
  id: string;
  url: string;
  kind: "subscription" | "extra_images";
  amountCents: number;
  currency: "BRL";
  offerVersion: string;
}
