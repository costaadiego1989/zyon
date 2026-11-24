/** Platform resources only. Credentials never belong in these public DTOs. */
export const PROSPECTING_PERMISSIONS = ["platform:prospecting:read", "platform:prospecting:write", "platform:prospecting:campaigns", "platform:prospecting:send", "platform:prospecting:knowledge", "platform:prospecting:admin"] as const;
export type ProspectingPermission = typeof PROSPECTING_PERMISSIONS[number];
export type ProspectStage = "new" | "contacted" | "responded" | "qualified" | "proposal" | "converted" | "lost" | "do_not_contact";
export type ContactPermissionStatus = "no_opt_in" | "opted_in" | "revoked";
export type ContactValidationState = "unknown" | "valid" | "invalid" | "whatsapp_confirmed";
export type CampaignState = "draft" | "freezing" | "review_ready" | "approved" | "running" | "paused" | "completed";
export type OutreachAttemptState = "prepared" | "reserved" | "submitting" | "provider_accepted" | "delivered" | "read" | "not_accepted" | "outcome_unknown" | "cancelled_before_submit";
export type CompanySnapshotState = "discovered" | "importing" | "validating" | "ready" | "published" | "failed";
export type KnowledgeState = "draft" | "projecting" | "published" | "withdrawn" | "failed";
export type ConversationMode = "ai" | "human";
export type ProspectMessageAuthor = "prospect" | "operator" | "ai" | "system";
export type KnowledgeOperation = "explain_feature" | "compare_plans" | "answer_faq" | "integration_capability";
export type ProspectingBlocker = "no_opt_in" | "provider_policy_blocked" | "sender_unavailable" | "sender_identity_mismatch" | "permission_unavailable" | "quality_restricted" | "template_unavailable" | "template_binding_mismatch" | "portfolio_limit" | "cost_unknown" | "suppressed" | "approval_stale" | "limits_missing" | "human_owned" | "outside_send_window";
export interface ProspectingPage<T> { items: T[]; nextCursor: string | null }
export interface ProspectingCommand { clientRequestId: string }
export interface ProspectingVersionedCommand extends ProspectingCommand { expectedVersion: number }
export interface ProspectingCommandResult<T = unknown> { clientRequestId: string; state: "pending" | "completed" | "failed" | "outcome_unknown"; result: T | null; errorCode: string | null }
export interface ProspectingMoney { amountCents: number; currency: string }
export interface CompanyFilters {
  mainCnaes?: string[]; secondaryCnaes?: string[]; ufs?: string[]; cityCodes?: string[]; districts?: string[];
  sizes?: string[]; legalNatures?: string[]; capitalMinCents?: string; capitalMaxCents?: string;
  statuses?: string[]; matrixBranches?: ("matrix" | "branch")[]; openedFrom?: string; openedTo?: string;
  simples?: boolean; mei?: boolean; stages?: ProspectStage[]; hasContact?: boolean;
  cnpj?: string; legalName?: string; tradeName?: string; search?: string;
}
export interface CompanySearchQuery { filters: CompanyFilters; snapshotId?: string; cursor?: string; limit?: number }
export interface CompanyDomainQuery { kind: "cnaes" | "municipios" | "naturezas"; uf?: string; snapshotId?: string; search?: string; afterCode?: string; limit?: number }
export interface CompanyDomainResult extends ProspectingPage<{kind:string;code:string;label:string}> { snapshotId:string;competence:string }
export interface CompanyPublicContact { channel: "phone" | "email"; originalValue: string; normalizedValue: string | null; validationState: ContactValidationState }
export interface CompanyRecord {
  snapshotId: string; competence: string; cnpj: string; baseCnpj: string; legalName: string; tradeName: string | null;
  legalNature: string | null; size: string | null; capitalCents: string | null; mainCnae: string | null;
  secondaryCnaes: string[]; cityCode: string | null; uf: string | null; district: string | null;
  openingDate: string | null; status: string | null; matrixBranch: "matrix" | "branch" | null;
  simples: boolean | null; mei: boolean | null; contacts: CompanyPublicContact[]; prospectId: string | null;
  stage: ProspectStage | null; suppressed: boolean;
}
export interface CompanySearchResult extends ProspectingPage<CompanyRecord> { snapshotId: string; competence: string; count: number | null; countState: "complete" | "pending"; filterHash: string }
export interface CompanySourceResource { id: string; family: string; url: string; competence: string; discoveredAt: string; etag: string | null; lastModified: string | null }
export interface CompanyManifest { id: string; competence: string; hash: string; parserVersion: string; resources: CompanySourceResource[]; discoveredAt: string }
export interface CompanyImportStatus { id: string; snapshotId: string; competence: string; state: CompanySnapshotState; committedCount: number; rejectedCount: number; files: { id: string; resourceId: string; state: string; batchIndex: number; computedHash: string | null; errorCode: string | null; rowOffset?:string;byteOffset?:string;compressedBytes?:string|null;rejectedCount?:number }[]; activeSnapshotId: string | null; errorCode: string | null }
export interface CompanyImportAccepted { importJobId:string;status:CompanyImportStatus }
export interface CompanyDirectoryCoverage {kind:"regional_retail";ufs:string[];mainCnaes:string[];companyCount:number;maximumDirectoryBytes:number;scopeComplete:boolean}
export interface CompanyDirectoryImportSummary {id:string;state:string;phase:string|null;committedCount:number;selectedCompanies:number;validatedFiles:number;totalFiles:number;errorCode:string|null;updatedAt:string}
export interface ImportCompanySnapshot extends ProspectingCommand { manifestId: string; competence: string }
export interface ProspectProviderIdentity { kind: "phone" | "email" | "bsuid"; value: string; businessScope: string | null }
export interface ProspectContact { endpointId: string; channel: "whatsapp" | "email"; normalizedValue: string | null; identity?: ProspectProviderIdentity | null; confirmationState: "unconfirmed" | "confirmed" | "ambiguous"; evidenceRef: string | null; permission: ContactPermissionStatus; timezone: string | null; timezoneSource: string | null }
export interface ProspectRecord {
  id: string; cnpj: string; sourceSnapshotId: string; stage: ProspectStage; assignedOperatorId: string | null;
  tags: string[]; version: number; createdAt: string; lastBusinessActivityAt: string;
  firstDeliveredAt?: string | null; firstAttemptAt: string | null; lastAttemptAt: string | null; lastDeliveredAt: string | null;
  lastReplyAt: string | null; lastReplyPreview: string | null; suppressed: boolean; contacts: ProspectContact[];
}
export interface ProspectDetail { prospect: ProspectRecord; company: CompanyRecord | null; conversationId: string | null; retentionHold: { reason: string; authorizationRef: string } | null }
export interface ProspectListQuery { stage?: ProspectStage[]; assignedOperatorId?: string; campaignId?: string; search?: string; cursor?: string; limit?: number; from?: string; to?: string }
export interface AddProspectsCommand extends ProspectingCommand { snapshotId: string; cnpjs?: string[]; selectionId?: string }
export interface AddProspectsResult { created: number; existing: number; prospectIds: string[] }
export interface UpdateProspectCommand extends ProspectingVersionedCommand { stage?: ProspectStage; assignedOperatorId?: string | null; tags?: string[] }
export interface BindProspectContactCommand extends ProspectingVersionedCommand { endpointId: string; evidenceRef: string }
export interface SavedProspectSegment { id: string; name: string; filters: CompanyFilters; filterVersion: number; ownerOperatorId: string; version: number; createdAt: string; updatedAt: string }
export interface ProspectSegmentSummary extends SavedProspectSegment { count: number | null; countState: "complete" | "pending"; snapshotId: string }
export interface SaveProspectSegment extends ProspectingCommand { name: string; filters: CompanyFilters; filterVersion: number; expectedVersion?: number }
export interface ProspectingSendWindow { timezone: string; weekdays: number[]; start: string; end: string }
export interface ProspectCampaignLimits { dailyRecipients: number; budget: ProspectingMoney }
export interface ProspectOffer { planKey: string; version: string; name: string; price: ProspectingMoney; billingCycle: string; features: string[]; canonicalUrl: string }
export interface ProspectCampaign {
  setupVersion?: 1 | 2;
  id: string; name: string; revision: number; state: CampaignState; audienceHash: string | null;
  contentHash: string | null; selectionId: string | null; message: string; offer: ProspectOffer | null;
  senderBindingId: string | null; senderVersion: number | null; template: ProspectingTemplate | null;
  limits: ProspectCampaignLimits | null; sendWindow: ProspectingSendWindow; approvedRevision: number | null;
  approvedBy: string | null; approvedAt: string | null; blockers: ProspectingBlocker[];
  recipientCount: number; reservedCents: number; spentCents: number; createdAt: string; updatedAt: string;
}
export interface SaveProspectCampaign extends ProspectingCommand { name: string; expectedRevision?: number; message: string; planKey: string; senderBindingId: string; senderVersion: number; limits: ProspectCampaignLimits; sendWindow: ProspectingSendWindow; template?: ProspectingTemplate | null }
/** V2 setup is a research draft; absent execution prerequisites remain null. */
export type ProspectOfferPolicy = { mode: "catalog" } | { mode: "fixed"; planKey: string };
export interface CreateProspectCampaignDraft extends ProspectingCommand { name: string; businessContext?: string; companies?: { snapshotId: string; cnpjs: string[] } }
export interface EditProspectCampaignDraft extends ProspectingCommand { expectedRevision: number; name?: string; businessContext?: string | null; offerPolicy?: ProspectOfferPolicy; message?: string | null; templateRegistryId?: string | null; senderBindingId?: string | null; senderVersion?: number | null; template?: ProspectingTemplate | null; limits?: ProspectCampaignLimits | null; sendWindow?: ProspectingSendWindow | null }
export interface ProspectCampaignDraft extends Omit<ProspectCampaign,"message"|"sendWindow"> { setupVersion: 2; businessContext: string | null; offerPolicy: ProspectOfferPolicy; message: string | null; templateRegistryId?: string | null; sendWindow: ProspectingSendWindow | null; directorySnapshotId: string | null; audienceCriteria: CompanyFilters | null; planningMode: "rules" | "model" | null; manualCompanyCount: number }
export interface ChangeCampaignCompanies extends ProspectingCommand { expectedRevision: number; snapshotId: string; cnpjs: string[] }
export interface CampaignCompanyReference { cnpj: string; snapshotId: string; competence: string; legalName: string; tradeName: string | null; mainCnae: string | null; cityCode: string | null; uf: string | null; addedAt: string | null }
export interface CampaignCompanyChangeResult { campaign: ProspectCampaignDraft; added: number; existing: number; removed: number }
export interface CampaignCompanyPage extends ProspectingPage<CampaignCompanyReference> { snapshotId: string | null; count: number; manualCount: number; criteria: CompanyFilters | null }
export interface PrepareCampaignContext extends ProspectingCommand { expectedRevision: number; snapshotId: string }
export interface CampaignPlanningJob { id: string; campaignId: string; expectedRevision: number; mode: "rules" | "model" | null; state: "pending" | "processing" | "completed" | "blocked" | "failed" | "outcome_unknown"; criteria: CompanyFilters | null; errorCode: string | null; reservedCents: number; spentCents: number }
export type PlatformProspectTemplateState = "draft" | "submitting" | "submission_unknown" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
export interface ProspectingMaxPrice { currency: "BRL"; amountPerThousandMinor: number }
export interface PlatformProspectTemplateDraft { id: string; purpose: "zyon_sales"; name: string; language: string; body: string; maxPrice?: ProspectingMaxPrice | null; revision: number; contentHash: string; bindingId: string | null; bindingVersion: number | null; wabaId: string | null; providerId: string | null; providerRevision: string | null; state: PlatformProspectTemplateState; reason: string | null; submittedAt: string | null; observedAt: string | null }
export interface CreatePlatformProspectTemplate extends ProspectingCommand { name: string; language: string; body: string; maxPrice?: ProspectingMaxPrice | null }
export interface SubmitPlatformProspectTemplate extends ProspectingCommand { expectedRevision: number }
export interface FreezeCampaignAudience extends ProspectingCommand { expectedRevision: number; snapshotId: string; segmentId?: string; segmentVersion?: number; cnpjs?: string[] }
export interface ProspectAudienceJob { eligibilityBlockers?: {reason:ProspectingBlocker;recipients:number}[]; selectionId: string; campaignId: string; state: "pending" | "processing" | "complete" | "failed"; companyCount: number; recipientCount: number; missingEndpointCount: number; audienceHash: string | null; errorCode: string | null }
export interface ApproveProspectCampaign extends ProspectingCommand { expectedRevision: number; audienceHash: string; contentHash: string }
export interface ProspectCampaignAction extends ProspectingCommand { expectedRevision: number; action: "start" | "pause" | "resume" }
export interface CampaignRecipientRecord { id: string; campaignId: string; prospectId: string; endpointId: string; sequenceKey: string; followUpDueAt?: string | null; attemptState?: OutreachAttemptState | null; eligibility: ContactPermissionStatus; frozenSnapshot: { snapshotId: string; cnpj: string }; state: OutreachAttemptState | "pending" | "blocked"; blockers: ProspectingBlocker[]; attemptId: string | null }
export interface OutreachAttemptRecord { id: string; sequenceId: string; ordinal: 0 | 1; clientRequestId: string; state: OutreachAttemptState; controlEpoch: number; providerMessageId: string | null; reservedAmount: ProspectingMoney; submittedAt: string | null; acceptedAt: string | null; deliveredAt: string | null; readAt: string | null; errorCode: string | null }
export interface ProspectingTemplate { id: string; wabaId: string; name: string; language: string; revision: string; category: "MARKETING" | "UTILITY" | "AUTHENTICATION"; status: string; previewText?: string | null; requiresParameters?: boolean; maxPrice?: ProspectingMaxPrice | null }
export interface PlatformSenderBinding { id: string; version: number; appId: string; wabaId: string; phoneNumberId: string; displayPhoneNumber: string; authorizationVersion: number; connectedBy: string; connectedAt: string }
export interface PlatformSenderReadiness { binding: PlatformSenderBinding | null; status: "ready" | "blocked" | "unknown"; updatedAt: string; templates: ProspectingTemplate[]; portfolioLimit: number | null; portfolioUsed: number | null; portfolioTier?: string | null; entities?: { type: string; id: string; status: string; errorCodes: number[] }[]; blockers: ProspectingBlocker[] }
export interface PlatformSenderSignupState { state: string; expiresAt: string; appId: string; configId: string; signupVersion: "v5"; extras: { version: "v5"; features: [{ name: "whatsapp_business_app_onboarding"; enabled: false }] }; authorizationMethod?: "system_user"; existingSender?: {businessId:string;wabaId:string;phoneNumberId:string;displayPhoneNumber:string} }
export interface ConnectPlatformSender extends ProspectingCommand { code: string; state: string; wabaId: string; phoneNumberId: string; businessId: string; messagingAccountIds: string[]; isOnBizApp: boolean }
export interface ConnectPlatformOwnSender extends ProspectingCommand { authorizationMethod:"system_user"; state:string }
export type ConnectPlatformSenderCommand = ConnectPlatformSender | ConnectPlatformOwnSender;
export interface ProspectMessage { id: string; conversationId: string; sequence: number; authorType: ProspectMessageAuthor; authorId: string | null; direction: "inbound" | "outbound"; content: string | null; providerId: string | null; attemptId: string | null; state: OutreachAttemptState | "received"; providerOccurredAt: string | null; createdAt: string }
export interface ProspectNote { id: string; conversationId: string; operatorId: string; content: string | null; createdAt: string }
export interface ProspectConversation {
  id: string; endpointId: string; prospectId: string | null; ambiguousBindings: string[]; mode: ConversationMode;
  assignedOperatorId: string | null; controlEpoch: number; lastSequence: number; readSequence: number;
  revision?: number; lastInboundMessageId?:string|null; unreadCount: number; lastInboundAt: string | null; lastInboundPreview: string | null; serviceWindowEndsAt: string | null;
}
export interface ProspectConversationHistory { conversation: ProspectConversation; messages: ProspectMessage[]; hasMore: boolean; nextCursor: string | null }
export interface ProspectConversationQuery { unread?: boolean; assignedOperatorId?: string; campaignId?: string; search?: string; cursor?: string; limit?: number }
export interface SendProspectMessage extends ProspectingCommand { content: string; expectedEpoch: number }
export interface ChangeProspectOwnership extends ProspectingCommand { action: "assume" | "release"; expectedEpoch: number }
export interface ProspectRealtimeEvent { id: string; cursor: string; conversationId: string; kind: "message" | "ownership" | "read" | "note" | "delivery"; sequence: number | null; occurredAt: string }
export interface SalesKnowledgeFact { id: string; subject: string; predicate: string; value: string; sourceId: string; publicationId: string; publicationVersion: number; validFrom: string; validUntil: string | null }
export interface SalesKnowledgeSource { id: string; title: string; sourceRef: string; version: number; state: KnowledgeState; draft: SalesKnowledgeFact[]; contentHash: string; validFrom: string; validUntil: string | null; publishedBy: string | null; activePublicationId: string | null; activePublicationVersion?: number | null; activeContentHash?: string | null; updatedAt: string }
export interface SaveSalesKnowledge extends ProspectingVersionedCommand { title: string; sourceRef: string; facts: Pick<SalesKnowledgeFact,"id"|"subject"|"predicate"|"value">[]; validFrom: string; validUntil: string | null }
export interface PublishSalesKnowledge extends ProspectingVersionedCommand { action: "publish" | "withdraw"; contentHash: string }
export interface SalesKnowledgeQuery { operation: KnowledgeOperation; params: { feature?: string; planKeys?: string[]; question?: string; integration?: string }; limit?: number }
export interface SalesKnowledgeAnswer { answer: string | null; handoff: boolean; reason: string | null; facts: SalesKnowledgeFact[]; sources: { id: string; publicationId: string; version: number }[]; callMode: "controlled" | "real"; offer: ProspectOffer | null }
export interface ProspectBillingProposal { id: string; prospectId: string; planKey: string; offerVersion: string; url: string; expiresAt: string; boundMerchantId: string | null; version: number }
export interface ProspectConversion { id: string; prospectId: string; proposalId: string; merchantId: string; provider: string; providerEventId: string; subscriptionId: string; state: "signup" | "trial" | "paid" | "refunded"; occurredAt: string }
export interface ProspectConversionHistoryItem {
  id: string; proposalId: string; merchantId: string; planKey: string; occurredAt: string;
  provider: "account" | "stripe" | "asaas";
  state: ProspectConversion["state"] | "account_bound" | "allocation_coverage_unknown";
}
export interface ProspectMetricsQuery { campaignId?: string; from: string; to: string }
export const PROSPECT_METRIC_NAMES=["leads","attempts","accepted","delivered","uniqueReplies","signups","trials","paidSubscriptions","refundedSubscriptions","unknownAllocationEvents"] as const;
export type ProspectMetricName=typeof PROSPECT_METRIC_NAMES[number];
export interface ProspectMetricRecordsQuery extends ProspectMetricsQuery {metric:ProspectMetricName; cursor?:string; limit?:number}
export interface ProspectMetricRecord {id:string;prospectId:string|null;conversationId:string|null;cnpj:string|null;occurredAt:string}
export interface ProspectMetrics {
  campaignId: string | null; from: string; to: string; updatedAt: string; leads: number; attempts: number;
  accepted: number; delivered: number; uniqueReplies: number; signups: number; trials: number; paidSubscriptions: number; refundedSubscriptions: number; unknownAllocationEvents: number;
  responseRate: { numerator: number; denominator: number; population: string; cohortUpdatedAt: string };
  costs: { totals: ProspectingMoney[]; commitments: { source: "meta" | "model"; currency: string; state: "reserved" | "unknown" | "committed"; amountCents: string; entries: number }[]; coverage: "complete" | "partial" | "unknown"; missing: string[] };
}
export interface ProspectPrivacyPolicy { retentionDays: 180; preservedSuppressions: number; lastRunAt: string | null; nextRunAt: string | null; backupPolicy: string; sourceSnapshotPolicy: string }
export interface SuppressProspectCommand extends ProspectingCommand { reason: string; expectedVersion: number }
export interface ProspectSuppressionResult { prospectId: string; suppressed: true; cancelledAttempts: number; inFlightAttempts: number; version: number }
