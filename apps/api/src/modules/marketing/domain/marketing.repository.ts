import type {
  MarketingCampaign,
  MarketingConsent,
  MarketingContact,
  MarketingContactQuery,
  MarketingConversation,
  MarketingMessage,
  MarketingRecipient,
  MarketingSettings,
  MarketingStageChange,
  MarketingConversationFilters,
  MarketingMessageCursor,
  MarketingHistoryJob,
  MarketingSuppression,
} from "./marketing.js";

export const MARKETING_REPOSITORY = Symbol("MARKETING_REPOSITORY");
export interface MarketingPage<T> {
  items: T[];
  total: number;
}
export interface MarketingTransaction {
  contact(id: string): Promise<MarketingContact | null>;
  contactByIdentity(key: string): Promise<MarketingContact | null>;
  contactByAccount(accountId: string): Promise<MarketingContact | null>;
  contactByPhone(phone: string): Promise<MarketingContact | null>;
  saveContact(contact: MarketingContact): Promise<void>;
  mergeContacts(sourceId: string, targetId: string): Promise<void>;
  contacts(
    query: MarketingContactQuery
  ): Promise<MarketingPage<MarketingContact>>;
  funnel(): Promise<
    Array<{
      stage: MarketingContact["stage"];
      origin: MarketingContact["origin"];
      total: number;
    }>
  >;
  contactActivity(id: string): Promise<{
    conversationCount: number;
    messageCount: number;
    conversations: MarketingConversation[];
  }>;
  conversation(id: string): Promise<MarketingConversation | null>;
  conversationByExternal(
    channel: string,
    externalId: string
  ): Promise<MarketingConversation | null>;
  conversations(
    limit: number,
    offset: number,
    filters?: MarketingConversationFilters
  ): Promise<
    MarketingPage<
      MarketingConversation & {
        contactName?: string | null;
        phoneTail?: string | null;
      }
    >
  >;
  saveConversation(conversation: MarketingConversation): Promise<void>;
  messages(
    conversationId: string,
    limit?: number,
    before?: MarketingMessageCursor
  ): Promise<MarketingMessage[]>;
  appendMessage(message: MarketingMessage): Promise<boolean>;
  messageByKey(key: string): Promise<MarketingMessage | null>;
  saveMessage(message: MarketingMessage): Promise<void>;
  consent(contactId: string): Promise<MarketingConsent | null>;
  consents(contactIds: string[]): Promise<MarketingConsent[]>;
  saveConsent(consent: MarketingConsent): Promise<void>;
  stageHistory(contactId: string): Promise<MarketingStageChange[]>;
  appendStage(change: MarketingStageChange): Promise<void>;
  settings(): Promise<MarketingSettings | null>;
  saveSettings(settings: MarketingSettings): Promise<void>;
  campaign(id: string): Promise<MarketingCampaign | null>;
  campaigns(): Promise<MarketingCampaign[]>;
  saveCampaign(campaign: MarketingCampaign): Promise<void>;
  recipients(campaignId: string): Promise<MarketingRecipient[]>;
  recipient(id: string): Promise<MarketingRecipient | null>;
  nextRecipient(campaignId: string): Promise<MarketingRecipient | null>;
  expiredRecipient(
    campaignId: string,
    now: string
  ): Promise<MarketingRecipient | null>;
  recipientCounts(campaignId: string): Promise<Record<string, number>>;
  latestConversation(
    contactId: string,
    channel: string
  ): Promise<MarketingConversation | null>;
  saveRecipient(recipient: MarketingRecipient): Promise<void>;
  saveRecipients(recipients: MarketingRecipient[]): Promise<void>;
  clearUnsentRecipients(campaignId: string): Promise<void>;
  receipt(key: string, occurredAt: string): Promise<boolean>;
  purchase(
    orderId: string,
    contactId: string,
    amountCents: number,
    occurredAt: string
  ): Promise<boolean>;
  reserveCommercial(
    contactKey: string,
    dispatchKey: string,
    now: string,
    minHours: number,
    dailyMax: number
  ): Promise<boolean>;
  commercialHistory(contactKey: string): Promise<Array<{ reservedAt: string }>>;
  updateDelivery(providerMessageId: string, status: string): Promise<number>;
  historyJob(): Promise<MarketingHistoryJob | null>;
  saveHistoryJob(job: MarketingHistoryJob): Promise<void>;
  appendMessages(messages: MarketingMessage[]): Promise<number>;
  suppression(hashes: string[]): Promise<MarketingSuppression | null>;
  saveSuppression(
    hash: string,
    suppression: MarketingSuppression
  ): Promise<void>;
  retentionCandidates(
    before: string,
    limit: number
  ): Promise<MarketingContact[]>;
  retentionCount(before: string): Promise<number>;
  removeRelationship(contactId: string): Promise<void>;
  liveMessageBoundary(conversationId: string): Promise<string | null>;
}
export interface MarketingRepository {
  transaction<T>(
    merchantId: string,
    resource: string,
    operation: (tx: MarketingTransaction) => Promise<T>,
    options?: { timeoutMs: number }
  ): Promise<T>;
  dueCampaigns(
    now: Date,
    limit: number
  ): Promise<Array<{ merchantId: string; id: string }>>;
  dueHistoryJobs(now: Date, limit: number): Promise<string[]>;
  dueRetention(now: Date, limit: number): Promise<string[]>;
}
