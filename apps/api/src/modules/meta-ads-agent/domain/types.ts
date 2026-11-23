import type {
  MetaAdsAsset, MetaAdsCampaign, MetaAdsCampaignDraft, MetaAdsCheckout,
  MetaAdsConnection, MetaAdsExecution, MetaAdsExecutionStatus, MetaAdsGeneration,
  MetaAdsMedia, MetaAdsMetrics, MetaAdsOffer, MetaAdsProduct,
  MetaAdsProposal, MetaAdsRecommendation, MetaAdsSubscription,
  MetaAdsPreparationLimits, MetaAdsAudienceSummary, MetaAdsAttributionRule,
} from "@zyon/shared-types";
import type { MetaAdsExposureState } from './exposure.js';

export class MetaAdsError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); this.name = "MetaAdsError"; }
}

export interface CreditReservation {
  id: string;
  periodKey: string | null;
  monthly: number;
  extra: number;
  requested: number;
  status: "reserved" | "unknown" | "settled" | "released";
  used: number;
}

export interface CreditState {
  monthlyAvailable: number;
  extraAvailable: number;
  periodKey: string | null;
  periodEndsAt: string | null;
  reservations: Record<string, CreditReservation>;
}

export interface StoredSubscription extends MetaAdsSubscription {
  checkoutId: string | null;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
}

export interface StoredConnection extends MetaAdsConnection {
  encryptedAccessToken: string | null;
  clientConversationId: string;
  scopes: string[];
}

export interface PendingOAuth {
  stateHash: string;
  actorId: string;
  expiresAt: string;
  redirectUri: string;
}

export interface StoredProposal extends MetaAdsProposal {
  remoteBefore: RemoteSnapshot | null;
  productVersions: Record<string, string>;
}

export interface MetaAdsStoreState {
  schemaVersion: 1;
  merchantId: string;
  automation?: { version: number; activePolicyId: string | null; lastPolicyId: string | null };
  exposure?: MetaAdsExposureState;
  subscription: StoredSubscription | null;
  credits: CreditState;
  connection: StoredConnection;
  pendingOAuth: PendingOAuth | null;
  campaigns: Record<string, MetaAdsCampaign>;
  media: Record<string, MetaAdsMedia>;
  generations: Record<string, MetaAdsGeneration>;
  proposals: Record<string, StoredProposal>;
  executions: Record<string, MetaAdsExecution>;
  metrics: Record<string, MetaAdsMetrics>;
  recommendations: Record<string, MetaAdsRecommendation>;
  purchases?: Record<string, AttributedPurchase>;
  purchaseScan?: { since: string; refreshAfter: string | null };
  preparationLimits?: MetaAdsPreparationLimits;
  preparationAdmissions?: Record<string, PreparationAdmission>;
  opportunityEvaluation?: { nextAt: string; policyVersion: number; lastError: string | null };
  attributionObservationSequence?: number;
  audienceSnapshots?: Record<string, MetaAdsAudienceSummary>;
  workspaceObservations?: Record<string, import('@zyon/shared-types').MetaAdsCampaignObservation & { campaignVersion?: string }>;
}

export type MetaAdsRecordKind = "billing_event" | "billing_period" | "checkout" | "generation" | "proposal" | "execution" | "usage" | "attribution" | "attribution_touch" | "purchase" | "observation" | "audit" | "cost_benchmark";

/** Internal authority and leases are not part of a public campaign DTO. */
export interface PreparationAdmission {
  id: string;
  opportunityDigest: string;
  policyId: string;
  policyVersion: number;
  connectionEpoch: number;
  actorId: string;
  accountLocalDay: string;
  campaignId: string | null;
  state: "reserved" | "preparing" | "review_ready" | "blocked" | "unknown" | "closed";
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface ProductOpportunityFact {
  product: MetaAdsProduct;
  since: string;
  until: string;
  paidUnits: number | null;
  netRevenueCents: number | null;
  adSpendCents: number | null;
  adPaidOrders: number | null;
  historicalCostCents: number | null;
  costCoverage: "complete" | "partial" | "unavailable";
}
export interface ProductOpportunityReader {
  read(merchantId: string, variantIds: string[], since: string, until: string): Promise<ProductOpportunityFact[]>;
}
export interface OpportunityModelPort {
  plan(input: {
    merchantId: string;
    actorId: string;
    planningKey: string;
    priority: MetaAdsCampaignDraft["priority"];
    destination: MetaAdsCampaignDraft["destination"];
    candidates: ProductOpportunityFact[];
  }): Promise<{ variantId: string; headline: string; primaryText: string; evidenceFields: string[]; quality: "observed" | "initial_test"; usage: TextModelUsage | null }>;
}

export interface PurchaseAttributionBinding {
  rule: MetaAdsAttributionRule;
  touchId: string | null;
  observedAt: string | null;
  frozenAt: string;
}

export interface AttributionTouch extends AttributionReceipt {
  merchantId: string;
  sessionId: string;
  observedAt: string;
  observationSequence: number;
  idempotencyKey: string;
}
export interface AttributionTouchRepository {
  capture(merchantId: string, receipt: AttributionReceipt, idempotencyKey: string): Promise<AttributionTouch>;
  byId(merchantId: string, id: string): Promise<AttributionTouch | null>;
  eligible(merchantId: string, sessionIds: string[], since: string, until: string): Promise<AttributionTouch[]>;
}
export interface MetaAdsRecord<T = unknown> {
  key: string;
  kind: MetaAdsRecordKind;
  payload: T;
  createdAt: string;
}
export interface MetaAdsMutation<T> { result: T; records?: MetaAdsRecord[]; }

export interface CampaignLifecycleRepository extends Pick<MetaAdsRepository, 'read' | 'getRecord'> {
  mutateCampaignLifecycle<T>(merchantId: string, campaignId: string, readKeys: string[], change: (
    state: MetaAdsStoreState, records: ReadonlyMap<string, MetaAdsRecord>, preparations: Array<{id: string; status: string}>
  ) => MetaAdsMutation<T> & {invalidatePreparations?: boolean}): Promise<T>;
}

export interface MetaAdsRepository {
  read(merchantId: string): Promise<MetaAdsStoreState>;
  mutate<T>(merchantId: string, readKeys: string[], change: (state: MetaAdsStoreState, existing: ReadonlyMap<string, MetaAdsRecord>) => MetaAdsMutation<T>): Promise<T>;
  getRecord<T = unknown>(merchantId: string, key: string): Promise<MetaAdsRecord<T> | null>;
  listRecords<T = unknown>(merchantId: string, kind: MetaAdsRecordKind, limit?: number, before?: string): Promise<MetaAdsRecord<T>[]>;
  listStoreIds(limit: number, after?: string): Promise<string[]>;
  listPendingGenerations(limit: number): Promise<Array<{ merchantId: string; generationId: string }>>;
}

export interface MerchantProfile { name: string; email: string; storefrontUrl: string; stripeCustomerId: string | null; }
export interface PaidOrderFact {
  orderId: string;
  sessionId: string;
  merchantId: string;
  paid: boolean;
  paidAt: string;
  currency: string;
  paidCents: number;
  refundedCents: number;
  costCents: number | null;
  costCoverage: "complete" | "partial" | "unavailable";
}
export interface CommerceContextPort {
  getPlan(merchantId: string): Promise<"starter" | "starter179" | "growth" | "scale">;
  getProfile(merchantId: string): Promise<MerchantProfile>;
  products(merchantId: string, input?: { variantIds?: string[]; query?: string; categoryId?:string; limit?: number }): Promise<MetaAdsProduct[]>;
  categories?(merchantId:string,input?:{query?:string;limit?:number}):Promise<{categories:Array<{id:string;name:string;productCount:number}>;hasMore:boolean}>;
  paidOrder(merchantId: string, orderId: string): Promise<PaidOrderFact | null>;
  paidOrders(merchantId: string, since: string, until: string): Promise<PaidOrderFact[]>;
}

export interface BillingCheckoutRequest {
  merchantId: string;
  contractId: string;
  idempotencyKey: string;
  kind: "subscription" | "extra_images";
  offer: MetaAdsOffer;
  profile: MerchantProfile;
}
export interface ProviderBillingEvent {
  eventId: string;
  merchantId: string;
  contractId: string;
  checkoutId: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  paymentId: string;
  kind: "subscription_paid" | "extra_images_paid" | "subscription_ended";
  amountCents: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  occurredAt: string;
}
export interface AddonBillingPort {
  quote(): Promise<{ amountCents: number; currency: string; cadence: string }>;
  createCheckout(input: BillingCheckoutRequest): Promise<MetaAdsCheckout>;
  cancelRenewal(subscriptionId: string): Promise<void>;
  verifiedEvent(rawBody: Buffer, signature: string): Promise<ProviderBillingEvent | null>;
}

export interface CredentialCodecPort { encrypt(merchantId: string, plaintext: string): string; decrypt(merchantId: string, ciphertext: string): string; }
export interface MetaOAuthPort {
  configured(): boolean;
  authorizationUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<{ accessToken: string; scopes: string[]; expiresAt: string | null }>;
}
export interface MetaAccess {
  /** Server-only proof. Never serialized into provider tool arguments or supplied by a model. */
  executionAuthority?: Pick<Extract<import('./execution-authority.port.js').ResolvedExecutionAuthority, { kind: 'automatic' }>, 'kind' | 'proposalId' | 'proposalDigest' | 'connectionEpoch' | 'policyId' | 'policyVersion'>;
  /** Server-only lease check, awaited immediately before each external write. */
  assertWriteAuthorized?: () => Promise<void>;
  merchantId: string;
  accessToken: string;
  clientConversationId: string;
  connectionEpoch: number;
  accountId: string | null;
  pageId: string | null;
  catalogId: string | null;
  datasetId: string | null;
  whatsappId: string | null;
}
export interface MetaDiscovery {
  accounts: MetaAdsAsset[];
  pages: MetaAdsAsset[];
  catalogs: MetaAdsAsset[];
  datasets: MetaAdsAsset[];
  whatsappNumbers: MetaAdsAsset[];
  capabilities: Record<string, boolean>;
  errors: string[];
}
export interface RemoteSnapshot {
  schedule?: { startsAt: string | null; endsAt: string | null };
  campaignId: string;
  status: string;
  effectiveStatus: string;
  budget: Record<string, unknown>;
  targeting: Record<string, unknown>;
  adSetId: string | null;
  adIds: string[];
  creativeIds: string[];
  objectStates?: Array<{ type: "ad_set" | "ad"; id: string; status: string; effectiveStatus: string }>;
}
export interface ProviderExecutionResult {
  status: MetaAdsExecutionStatus;
  objects: MetaAdsExecution["objects"];
  error?: string;
}
export interface ProviderMetricSnapshot {
  campaignId: string;
  currency: string;
  since: string;
  until: string;
  timezone: string;
  attributionWindow: string;
  requestedAttributionWindow?: string | null;
  effectiveAttributionWindow?: string | null;
  spendCents: number | null;
  attributedRevenueCents: number | null;
  attributedPurchases: number | null;
  conversations: number | null;
  impressions?: number | null;
  reach?: number | null;
  linkClicks?: number | null;
}
export interface MetaAdsProviderPort {
  discover(access: MetaAccess): Promise<MetaDiscovery>;
  existingCampaigns(access: MetaAccess): Promise<Array<{ id: string; name: string; status: string }>>;
  snapshot(access: MetaAccess, campaign: MetaAdsCampaign): Promise<RemoteSnapshot>;
  prepare(access: MetaAccess, campaign: MetaAdsCampaign, media: MetaAdsMedia[], onProgress: (objects: MetaAdsExecution["objects"]) => Promise<void>): Promise<ProviderExecutionResult>;
  execute(access: MetaAccess, campaign: MetaAdsCampaign, proposal: MetaAdsProposal, onProgress: (objects: MetaAdsExecution["objects"]) => Promise<void>): Promise<ProviderExecutionResult>;
  reconcile(access: MetaAccess, campaign: MetaAdsCampaign, execution: MetaAdsExecution): Promise<ProviderExecutionResult>;
  metrics(access: MetaAccess, campaign: MetaAdsCampaign, since: string, until: string): Promise<ProviderMetricSnapshot>;
}

export interface ImageUsage {
  provider: string;
  model: string;
  providerRequestId: string | null;
  inputTextTokens: number | null;
  inputImageTokens: number | null;
  outputImageTokens: number | null;
  costMicros: string | null;
  currency: string | null;
  costStatus: "unpriced" | "estimated" | "provider_reported";
}
export interface GeneratedImageResult {
  status: "succeeded" | "failed" | "unknown";
  url: string | null;
  usage: ImageUsage;
  error: string | null;
  commercialReview?: MetaAdsMedia["commercialReview"];
  reviewUsage?: TextModelUsage[];
}
export interface TextModelUsage {
  provider: string;
  model: string;
  providerRequestId: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costMicros: string | null;
  currency: string | null;
  costStatus: "unpriced" | "estimated" | "provider_reported";
}
export interface CreativeReviewResult {
  status: "verified" | "rejected" | "unavailable";
  productVersion: string;
  imageSha256: string;
  error: string | null;
  usage: TextModelUsage;
}
export interface CreativeReviewPort {
  configured(): boolean;
  review(input: { product: MetaAdsProduct; image: Buffer }): Promise<CreativeReviewResult>;
}
export interface ImageGenerationPort {
  configured(): boolean;
  generate(input: { merchantId: string; generationId: string; imageIndex: number; product: MetaAdsProduct; brief: MetaAdsCampaignDraft; assertAuthorized?:()=>Promise<void> }): Promise<GeneratedImageResult>;
}
export interface CatalogImagePort {
  configured():boolean;
  capture(input:{merchantId:string;mediaKey:string;product:MetaAdsProduct}):Promise<{url:string;sourceUrl:string;imageSha256:string}>;
}
export interface PreparationGenerationAuthority {preparationId:string;intentDigest:string;}
export type GenerationAuthorizer=(merchantId:string,authority:PreparationGenerationAuthority,campaign:MetaAdsCampaign)=>Promise<void>;
export interface AttributionReceipt {
  originSessionId?: string;
  id: string;
  campaignId: string;
  sessionId: string | null;
  consent: boolean;
  consentVersion: string;
  grantedAt: string;
  revokedAt: string | null;
  source: "store" | "whatsapp";
  fbc: string | null;
  fbp: string | null;
  ctwaClid?: string | null;
  clientUserAgent?: string | null;
}
export interface AttributedPurchase {
  orderId: string;
  eventId: string;
  campaignId: string | null;
  source: "store" | "whatsapp" | null;
  fact: PaidOrderFact;
  netRevenueCents: number;
  signalStatus: "not_authorized" | "sending" | "sent" | "failed" | "unknown";
  reconciledAt: string;
  attribution?: PurchaseAttributionBinding;
}
export interface PurchaseSignal {
  eventId: string;
  eventTime: string;
  orderId: string;
  currency: string;
  valueCents: number;
  source: "store" | "whatsapp";
  fbc: string | null;
  fbp: string | null;
  ctwaClid?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl?: string | null;
}
export interface WhatsappConversionsContextPort {
  get(merchantId: string): Promise<{ merchantId: string; wabaId: string; phoneNumberId: string; phoneNumber: string; accessToken: string } | null>;
}
export interface AttributionSessionBindingPort { parent(merchantId: string, checkoutSessionId: string): Promise<string | null>; }
export const META_ADS_SESSION_BINDING = Symbol("MetaAdsSessionBinding");
export interface ConversionsPort { send(access: MetaAccess, signal: PurchaseSignal): Promise<{ status: "sent" | "failed" | "unknown"; error: string | null }>; }
export interface RecommendationPort {
  configured?(): boolean;
  /** Stable analysis keys recover known paid steps without replaying unknown calls. */
  durable?: boolean;
  recommend(input: { merchantId: string; analysisKey?: string; campaigns: Array<{ campaign: MetaAdsCampaign; metrics: MetaAdsMetrics }> }): Promise<{ recommendations: MetaAdsRecommendation[]; usage: TextModelUsage | null }>;
}

export type Clock = () => Date;
export type IdFactory = () => string;
export const META_ADS_REPOSITORY = Symbol("MetaAdsRepository");
export const META_ADS_COMMERCE = Symbol("MetaAdsCommerce");
export const META_ADS_BILLING = Symbol("MetaAdsBilling");
export const META_ADS_PROVIDER = Symbol("MetaAdsProvider");
export const META_ADS_IMAGES = Symbol("MetaAdsImages");
export const META_ADS_CONVERSIONS = Symbol("MetaAdsConversions");

export function initialStore(merchantId: string): MetaAdsStoreState {
  return {
    schemaVersion: 1, merchantId, subscription: null,
    credits: { monthlyAvailable: 0, extraAvailable: 0, periodKey: null, periodEndsAt: null, reservations: {} },
    connection: { status: "disconnected", epoch: 0, account: null, page: null, catalog: null, dataset: null, whatsapp: null,
      accounts: [], pages: [], catalogs: [], datasets: [], whatsappNumbers: [], capabilities: {}, lastError: null,
      connectedAt: null, expiresAt: null, oauthConfigured: false, encryptedAccessToken: null, clientConversationId: "", scopes: [] },
    pendingOAuth: null, campaigns: {}, media: {}, generations: {}, proposals: {}, executions: {}, metrics: {}, recommendations: {},
  };
}
