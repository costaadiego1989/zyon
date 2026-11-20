import type {
  AddProspectsCommand, AddProspectsResult, ApproveProspectCampaign, CampaignRecipientRecord,
  ChangeProspectOwnership, CompanyImportStatus, CompanyManifest, CompanyRecord, CompanySearchQuery,
  CompanySearchResult, FreezeCampaignAudience, OutreachAttemptRecord, PlatformSenderBinding,
  PlatformSenderReadiness, ProspectBillingProposal, ProspectCampaign, ProspectCampaignAction,
  ProspectContact, ProspectConversation, ProspectConversationHistory, ProspectConversationQuery,
  ProspectConversion, ProspectDetail, ProspectListQuery, ProspectMessage, ProspectNote,
  ProspectOffer, ProspectRecord, ProspectingCommandResult, ProspectingPage, SaveProspectCampaign,
  SaveProspectSegment, SavedProspectSegment, SalesKnowledgeAnswer, SalesKnowledgeFact,
  SalesKnowledgeQuery, SalesKnowledgeSource, SendProspectMessage, UpdateProspectCommand,
} from "@zyon/shared-types";

export interface ProspectingActor { operatorId: string; correlationId: string }
export interface ProspectingAudit { actorOperatorId: string | null; action: string; resourceId: string; resourceVersion: number; correlationId: string; outcome: string; occurredAt: Date; details?: Record<string, unknown> }
export interface DirectoryBatch { snapshotId: string; fileId: string; fileHash: string; batchIndex: number; rowOffset: number; byteOffset: number; entities: DirectoryEntity[]; establishments: DirectoryEstablishment[]; domains: { kind: string; code: string; label: string }[]; taxes?: { baseCnpj: string; simples: boolean | null; mei: boolean | null }[]; rejectedCount?: number }
export interface DirectoryEntity { baseCnpj: string; legalName: string; legalNature: string | null; size: string | null; capitalCents: string | null; simples: boolean | null; mei: boolean | null }
export type DirectoryEstablishment = Pick<CompanyRecord, "cnpj" | "baseCnpj" | "tradeName" | "mainCnae" | "secondaryCnaes" | "cityCode" | "uf" | "district" | "openingDate" | "status" | "matrixBranch" | "contacts">;
export type DirectoryDecodedRow = { kind: "entity"; value: DirectoryEntity } | { kind: "establishment"; value: DirectoryEstablishment } | { kind: "tax"; value: { baseCnpj: string; simples: boolean | null; mei: boolean | null } } | { kind: "domain"; value: { kind: string; code: string; label: string } } | { kind: "rejected"; errorCode: string };
export interface PreparedDirectoryArchive { fileHash: string; compressedBytes: number; rows(): AsyncIterable<DirectoryDecodedRow>; close(): Promise<void> }
export interface DirectoryArchivePort { prepare(resource: import("@zyon/shared-types").CompanySourceResource): Promise<PreparedDirectoryArchive> }
export interface CompanyDirectoryPort {
  search(query: CompanySearchQuery): Promise<CompanySearchResult>;
  find(cnpj: string, snapshotId?: string): Promise<CompanyRecord | null>;
  saveManifest(manifest: CompanyManifest): Promise<CompanyImportStatus>;
  getImport(id: string): Promise<CompanyImportStatus | null>;
  commitBatch(batch: DirectoryBatch): Promise<{ committed: number; replay: boolean }>;
  publish(snapshotId: string, expectedActiveSnapshotId: string | null): Promise<void>;
}
export interface ProspectRepositoryPort {
  add(command: AddProspectsCommand, actor: ProspectingActor): Promise<AddProspectsResult>;
  list(query: ProspectListQuery): Promise<ProspectingPage<ProspectRecord>>;
  find(id: string): Promise<ProspectDetail | null>;
  update(id: string, command: UpdateProspectCommand, actor: ProspectingActor): Promise<ProspectRecord>;
  bindContact(id: string, contact: ProspectContact, expectedVersion: number, actor: ProspectingActor): Promise<ProspectRecord>;
  commandResult(clientRequestId: string, actor: ProspectingActor): Promise<ProspectingCommandResult | null>;
}
export interface SegmentRepositoryPort {
  list(cursor?: string): Promise<ProspectingPage<SavedProspectSegment>>;
  find(id: string): Promise<SavedProspectSegment | null>;
  save(id: string | null, command: SaveProspectSegment, actor: ProspectingActor): Promise<SavedProspectSegment>;
  remove(id: string, expectedVersion: number, actor: ProspectingActor): Promise<void>;
}
export interface AttemptReservation { attempt: OutreachAttemptRecord; ownerToken: string; campaignId: string | null; recipientId: string | null; senderBindingId: string; senderVersion: number; endpointId: string; normalizedEndpoint: string; content: string; expectedEpoch: number }
export type ProspectSendResult = { state: "provider_accepted"; providerMessageId: string; acceptedAt: Date } | { state: "not_accepted"; errorCode: string } | { state: "outcome_unknown"; errorCode: string };
export interface CampaignRepositoryPort {
  create(command: SaveProspectCampaign, actor: ProspectingActor): Promise<ProspectCampaign>;
  find(id: string): Promise<ProspectCampaign | null>;
  revise(id: string, command: SaveProspectCampaign, actor: ProspectingActor): Promise<ProspectCampaign>;
  freezeAudience(id: string, command: FreezeCampaignAudience, actor: ProspectingActor): Promise<ProspectCampaign>;
  approve(id: string, command: ApproveProspectCampaign, actor: ProspectingActor): Promise<ProspectCampaign>;
  changeState(id: string, command: ProspectCampaignAction, actor: ProspectingActor): Promise<ProspectCampaign>;
  recipients(id: string, cursor?: string): Promise<ProspectingPage<CampaignRecipientRecord>>;
  reserveAttempt(recipientId: string, ownerToken: string, now: Date): Promise<AttemptReservation | null>;
  markSubmitting(attemptId: string, ownerToken: string, now: Date): Promise<boolean>;
  recordResult(attemptId: string, ownerToken: string, result: ProspectSendResult): Promise<OutreachAttemptRecord>;
}
export interface PlatformSenderPort {
  binding(): Promise<PlatformSenderBinding | null>;
  readiness(): Promise<PlatformSenderReadiness>;
  send(attempt: AttemptReservation, binding: PlatformSenderBinding): Promise<ProspectSendResult>;
}
export interface ProspectWebhookEvent { eventId: string; senderBindingId: string; eventKind: "inbound" | "status"; payloadHash: string; providerOccurredAt: Date; receivedAt: Date; payload: Record<string, unknown> }
export interface ProspectInboxPort {
  acceptWebhook(event: ProspectWebhookEvent): Promise<{ id: string; replay: boolean }>;
  pending(limit: number): Promise<ProspectWebhookEvent[]>;
  markProcessed(event: ProspectWebhookEvent): Promise<void>;
}
export interface ConversationRepositoryPort {
  list(query: ProspectConversationQuery, actor: ProspectingActor): Promise<ProspectingPage<ProspectConversation>>;
  history(id: string, pagination: { before?: number; after?: number; limit?: number }, actor: ProspectingActor): Promise<ProspectConversationHistory>;
  appendInbound(event: ProspectWebhookEvent): Promise<ProspectMessage>;
  assumeConversation(id: string, command: ChangeProspectOwnership, actor: ProspectingActor): Promise<ProspectConversation>;
  prepareMessage(id: string, command: SendProspectMessage, actor: ProspectingActor): Promise<OutreachAttemptRecord>;
  markRead(id: string, sequence: number, actor: ProspectingActor): Promise<number>;
  addNote(id: string, content: string, clientRequestId: string, actor: ProspectingActor): Promise<ProspectNote>;
}
export interface SalesKnowledgePort {
  list(): Promise<SalesKnowledgeSource[]>;
  find(id: string): Promise<SalesKnowledgeSource | null>;
  queryPublishedKnowledge(query: SalesKnowledgeQuery, now: Date): Promise<SalesKnowledgeFact[]>;
}
export type SalesToolName = "knowledge" | "canonical_offer" | "allowed_link" | "qualify" | "human_handoff";
export interface SalesLlmRequest { conversationId: string; controlEpoch: number; input: string; facts: SalesKnowledgeFact[]; offer: ProspectOffer; allowedTools: readonly SalesToolName[]; maximumCostCents: number; timeoutMs: number }
export interface SalesLlmPort { respond(input: SalesLlmRequest): Promise<SalesKnowledgeAnswer> }
export interface CanonicalBillingOfferPort { current(planKey: string): Promise<ProspectOffer>; allowedUrl(url: string): boolean }
export interface VerifiedProspectPayment { verified: true; provider: string; providerEventId: string; proposalId: string; merchantId: string; subscriptionId: string; state: "paid" | "refunded"; occurredAt: Date }
export interface ProspectBillingPort {
  createSignupProposal(prospectId: string, planKey: string, clientRequestId: string, actor: ProspectingActor): Promise<ProspectBillingProposal>;
  bindAuthenticatedAccount(proposalId: string, token: string, merchantId: string, authenticatedUserId: string): Promise<ProspectBillingProposal>;
  recordVerifiedConversion(event: VerifiedProspectPayment): Promise<ProspectConversion>;
}
export const PROSPECTING_PORTS = {
  directory: Symbol("CompanyDirectoryPort"), prospects: Symbol("ProspectRepositoryPort"), segments: Symbol("SegmentRepositoryPort"),
  campaigns: Symbol("CampaignRepositoryPort"), sender: Symbol("PlatformSenderPort"), inbox: Symbol("ProspectInboxPort"),
  conversations: Symbol("ConversationRepositoryPort"), knowledge: Symbol("SalesKnowledgePort"), llm: Symbol("SalesLlmPort"),
  offers: Symbol("CanonicalBillingOfferPort"), billing: Symbol("ProspectBillingPort"),
} as const;
