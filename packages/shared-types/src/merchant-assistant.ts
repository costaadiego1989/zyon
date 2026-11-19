import type {
  MetaAdsActionKind, MetaAdsCampaign, MetaAdsCampaignDraft, MetaAdsExecution,
  MetaAdsGeneration, MetaAdsMetrics, MetaAdsPriority, MetaAdsProposal, MetaAdsRecommendation,
} from './meta-ads-agent.js';

/** Public assistant contracts. Credentials and execution authority are server-only. */
export interface AssistantContextDescriptor { id: string; label: string; capabilities: string[]; }
export interface AssistantReference {
  id: string;
  version: string;
  title: string;
  url: string;
  reviewedAt: string;
  excerpt: string;
}
export type AssistantTurnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
export interface AssistantTurnInput { message: string; idempotencyKey: string; expectedRevision: number; }
/** Conversation data only. It cannot authorize spend, publication or an optimization policy. */
export interface AssistantCampaignBriefing {
  selectionKind?: 'product' | 'category' | 'catalog';
  selectionQuery?: string;
  selectedVariantId?: string;
  categoryId?: string;
  budget?: { amountCents?: number; cadence?: 'daily' | 'lifetime'; startText?: string; endText?: string; startsAt?: string; endsAt?: string | null };
  /** Server-derived account floor warning. Conversation data, never permission to increase spend. */
  budgetIssue?: {amountCents:number;minimumDailyBudgetCents:number;currency:string;accountId:string;checkedAt:string};
  /** Exact merchant answers awaiting interpretation; bounded and never treated as instructions. */
  answers?: Partial<Record<'destination'|'selection'|'priority'|'amount'|'cadence'|'start'|'end'|'country',string>>;
  categoryOptions?: Array<{id:string;name:string}>;
  productOptions?: Array<{variantId:string;name:string}>;
  capturedTurnId?: string;
}
export interface AssistantCampaignProgress {
  planningKind?: 'campaign' | 'automation';
  automationBriefing?: AssistantAutomationBriefing;
  campaignId: string | null;
  draft: Partial<MetaAdsCampaignDraft>;
  awaitingFields: string[];
  /** Conversation preference only. Automatic authority requires an independently accepted policy. */
  approvalPreference?: 'manual' | 'automatic';
  /** Creative count requested during planning, within the existing image allowance. */
  requestedImages?: number;
  briefing?: AssistantCampaignBriefing;
}
/** Draft conversation only; an accepted, versioned policy is stored separately. */
export interface AssistantAutomationBriefing {
  scope: Partial<MetaAdsAutomationPolicyInput['scope']>;
  limits: Partial<MetaAdsAutomationPolicyInput['limits']>;
  selection?: Pick<AssistantCampaignBriefing,'selectionKind'|'selectionQuery'|'selectedVariantId'|'categoryId'|'categoryOptions'|'productOptions'>;
  startText?: string; endText?: string;
  answers?: Record<string,string>;
  capturedTurnId?: string;
}
export interface AssistantTurn {
  id: string;
  threadId: string;
  ordinal: number;
  status: AssistantTurnStatus;
  message: string;
  reply: string | null;
  references: AssistantReference[];
  artifacts: AssistantArtifact[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AssistantThread {
  id: string;
  context: AssistantContextDescriptor;
  revision: number;
  campaign: AssistantCampaignProgress | null;
  turns: AssistantTurn[];
  nextCursor: string | null;
  updatedAt: string;
}

export interface MetaAdsFundingSnapshot {
  accountId: string;
  accountName: string;
  currency: string | null;
  billingType: 'prepaid' | 'postpaid' | 'unknown';
  paymentMethod: 'present' | 'missing' | 'unknown';
  confirmedBlock: boolean;
  blockCode: string | null;
  amountDueCents: number | null;
  prepaidAvailableCents: number | null;
  checkedAt: string;
  source: string;
  paymentUrl: string | null;
}
export interface MetaAdsFundingDiagnosis {
  snapshot: MetaAdsFundingSnapshot | null;
  status: 'ready' | 'attention' | 'blocked' | 'unknown';
  message: string;
  nextSteps: string[];
  error: string | null;
}

export type MetaAdsAutomaticAction = Exclude<MetaAdsActionKind, 'audience' | 'launch'>;
export interface MetaAdsAutomationScope {
  variantIds: string[];
  campaignIds: string[];
  allowNewCampaigns: boolean;
  destination: MetaAdsCampaignDraft['destination'];
  priority: MetaAdsPriority;
  country: string;
  actions: MetaAdsAutomaticAction[];
}
export interface MetaAdsAutomationLimits {
  currency: 'BRL';
  cadence: 'daily' | 'lifetime';
  campaignCeilingCents: number;
  storeCeilingCents: number;
  startsAt: string;
  endsAt: string;
}
export interface MetaAdsAutomationPolicyInput {
  scope: MetaAdsAutomationScope;
  limits: MetaAdsAutomationLimits;
}
export interface MetaAdsAutomationPolicy {
  id: string;
  version: number;
  accountId: string;
  connectionEpoch: number;
  scope: MetaAdsAutomationScope;
  limits: MetaAdsAutomationLimits;
  digest: string;
  acceptedBy: string;
  acceptedAt: string;
  revokedAt: string | null;
}
export interface MetaAdsAutomationReview {
  accountId: string;
  connectionEpoch: number;
  version: number;
  scope: MetaAdsAutomationScope;
  limits: MetaAdsAutomationLimits;
  digest: string;
  warnings: string[];
}
export interface MetaAdsAutomationState {
  mode: 'manual' | 'automatic';
  policy: MetaAdsAutomationPolicy | null;
  committedCents: number;
  availableCents: number | null;
}

export interface MetaAdsDailyCampaignReport {
  campaignId: string;
  metrics: MetaAdsMetrics | null;
  status: 'available' | 'awaiting_data' | 'unavailable';
  missing: string[];
  recommendations: MetaAdsRecommendation[];
  actions: Array<{ proposalId: string; executionId: string | null; status: string; reason: string; error: string | null }>;
}
export interface MetaAdsDailyReport {
  id: string;
  accountId: string;
  localDay: string;
  timezone: string;
  since: string;
  until: string;
  status: 'collecting' | 'partial' | 'completed';
  analysisStatus: 'pending' | 'completed' | 'awaiting_data' | 'unknown' | 'unavailable';
  collectedAt: string | null;
  updatedAt: string;
  campaigns: MetaAdsDailyCampaignReport[];
  notes: string[];
}

export type AssistantArtifact =
  | { type: 'campaign'; campaign: MetaAdsCampaign }
  | { type: 'campaign_progress'; progress: AssistantCampaignProgress }
  | { type: 'generation'; generation: MetaAdsGeneration }
  | { type: 'proposal'; proposal: MetaAdsProposal; execution: MetaAdsExecution | null }
  | { type: 'funding'; diagnosis: MetaAdsFundingDiagnosis }
  | { type: 'campaign_status'; snapshot: { campaignId: string; accountId: string; checkedAt: string; source: 'meta_configuration'; configuredStatus: string; effectiveStatus: string; objectStates: Array<{ type: 'ad_set' | 'ad'; id: string; status: string; effectiveStatus: string }>; deliveryConfirmed: false } }
  | { type: 'automation_review'; review: MetaAdsAutomationReview }
  | { type: 'automation'; state: MetaAdsAutomationState }
  | { type: 'daily_report'; report: MetaAdsDailyReport };
