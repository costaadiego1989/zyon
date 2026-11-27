export const MARKETING_STAGES = [
  "new",
  "interested",
  "shopping",
  "payment_pending",
  "purchased",
  "lost",
] as const;
export type MarketingStage = (typeof MARKETING_STAGES)[number];
export type MarketingChannel = "site" | "whatsapp";
export type MarketingOrigin = MarketingChannel | "unknown";
export type MarketingRole = "buyer" | "ai" | "agent" | "system";
export type MarketingDeliveryStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "delivered"
  | "read"
  | "failed"
  | "suppressed"
  | "unknown"
  | "recorded";
export type MarketingConsentStatus = "granted" | "declined" | "revoked";
export {
  MARKETING_CONSENT_VERSION,
  MARKETING_CONSENT_TEXT,
  MARKETING_ACCEPT,
  MARKETING_DECLINE,
} from "../../../shared/contracts/marketing.js";

export class MarketingError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400
  ) {
    super(code);
  }
}

export interface MarketingContact {
  id: string;
  merchantId: string;
  identityKey: string;
  accountId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  origin: MarketingOrigin;
  channels: MarketingChannel[];
  stage: MarketingStage;
  stageAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  version: number;
  purchaseCount: number;
  totalSpentCents: number;
  lastPurchaseAt: string | null;
  interests: string[];
  mergedInto?: string;
}

export interface MarketingConversation {
  id: string;
  merchantId: string;
  contactId: string | null;
  channel: MarketingChannel | "unknown";
  externalId: string;
  mode: "ai" | "human";
  assignedUserId: string | null;
  version: number;
  lastInboundAt: string;
  updatedAt: string;
  deviceId: string | null;
  openingChoice: "pending" | "granted" | "declined";
  pendingQuestion: string | null;
  pendingQuestionId?: string | null;
}

export interface MarketingMessage {
  id: string;
  merchantId: string;
  conversationId: string;
  dedupKey: string;
  role: MarketingRole;
  content: string;
  createdAt: string;
  status: MarketingDeliveryStatus;
  providerMessageId: string | null;
  authorId: string | null;
  campaignId: string | null;
  mediaUrl?: string;
  mediaType?: string;
  serviceQuestion?: string;
  responseKey?: string;
  sequence?: string;
}
export interface MarketingConversationFilters {
  channel?: MarketingChannel;
  mode?: "ai" | "human";
  assignedUserId?: string | null;
  search?: string;
}
export interface MarketingMessageCursor {
  createdAt: string;
  sequence: string;
}

export interface MarketingConsent {
  id: string;
  merchantId: string;
  contactId: string;
  channel: "whatsapp";
  status: MarketingConsentStatus;
  version: string;
  text: string;
  source: string;
  recordedAt: string;
  evidenceId: string;
}

export interface MarketingStageChange {
  id: string;
  merchantId: string;
  contactId: string;
  from: MarketingStage;
  to: MarketingStage;
  author: "agent" | "ai" | "business";
  authorId: string;
  reason: string;
  occurredAt: string;
}

export interface MarketingSettings {
  id: string;
  merchantId: string;
  timezone: string;
  startHour: number;
  endHour: number;
  minIntervalHours: number;
  maxMessagesPerDay: number;
  retentionDays: number;
  configured: boolean;
  updatedAt: string;
  retentionLastRunAt?: string;
}
export interface MarketingHistoryJob {
  merchantId: string;
  status: "queued" | "running" | "completed" | "failed";
  phase: "whatsapp" | "buyers" | "orders";
  cursor: string | null;
  snapshotAt: string;
  records: number;
  messages: number;
  leaseToken: string | null;
  leaseUntil: string | null;
  reason: string | null;
  updatedAt: string;
}
export interface MarketingSuppression {
  status: "declined" | "revoked";
  recordedAt: string;
  version: string;
  evidenceHash: string;
}
export interface MarketingHistoricalRelationship {
  merchantId: string;
  channel: MarketingConversation["channel"];
  conversationKey: string;
  accountId?: string;
  verifiedPhone?: string;
  occurredAt: string;
  lastSeenAt: string;
  deviceId?: string;
  messages: Array<{
    role: "buyer" | "ai";
    content: string;
    occurredAt: string;
  }>;
}

export interface MarketingSegment {
  stage?: MarketingStage;
  origin?: MarketingOrigin;
  buyer?: "lead" | "customer";
  interest?: string;
}

export interface MarketingCampaign {
  id: string;
  merchantId: string;
  name: string;
  body: string;
  language: string;
  segment: MarketingSegment;
  status:
    | "draft"
    | "approved"
    | "scheduled"
    | "running"
    | "paused"
    | "completed";
  version: number;
  approvedVersion: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
  templateName: string | null;
  templateStatus: string;
  templateWabaId: string | null;
  budgetCents: number;
  maxUnitCostCents: number;
  reservedCents: number;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  audience?: {
    selected: number;
    eligible: number;
    excluded: Record<string, number>;
  };
  pauseReason?: string;
}

export interface MarketingRecipient {
  id: string;
  merchantId: string;
  campaignId: string;
  contactId: string;
  campaignVersion: number;
  status: MarketingDeliveryStatus;
  reason: string | null;
  providerMessageId: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
  attemptedAt: string | null;
  costReservedCents: number;
  updatedAt: string;
}

export interface MarketingContactQuery {
  search?: string;
  channel?: MarketingChannel;
  stage?: MarketingStage;
  origin?: MarketingOrigin;
  buyer?: "lead" | "customer";
  interest?: string;
  limit: number;
  offset: number;
}

export function marketingPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const phone =
    digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (!/^[1-9]\d{7,14}$/.test(phone))
    throw new MarketingError("marketing_phone_invalid");
  return phone;
}

export function requireMarketingPlan(plan: string): void {
  if (plan !== "growth" && plan !== "scale")
    throw new MarketingError("marketing_plan_required", 403);
}

export function requireMarketingApprover(role: string): void {
  if (role !== "owner" && role !== "admin")
    throw new MarketingError("marketing_approval_forbidden", 403);
}

export function validateMarketingSettings(value: MarketingSettings): void {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value.timezone }).format();
  } catch {
    throw new MarketingError("marketing_timezone_invalid");
  }
  if (
    !Number.isInteger(value.startHour) ||
    !Number.isInteger(value.endHour) ||
    value.startHour < 0 ||
    value.startHour > 23 ||
    value.endHour < 1 ||
    value.endHour > 24 ||
    value.startHour === value.endHour ||
    !Number.isInteger(value.minIntervalHours) ||
    value.minIntervalHours < 1 ||
    value.minIntervalHours > 8760 ||
    !Number.isInteger(value.maxMessagesPerDay) ||
    value.maxMessagesPerDay < 1 ||
    value.maxMessagesPerDay > 100 ||
    !Number.isInteger(value.retentionDays) ||
    value.retentionDays < 1 ||
    value.retentionDays > 3650
  ) {
    throw new MarketingError("marketing_settings_invalid");
  }
}

export function withinMarketingHours(
  settings: MarketingSettings,
  now: Date
): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: settings.timezone,
    }).format(now)
  );
  return settings.startHour < settings.endHour
    ? hour >= settings.startHour && hour < settings.endHour
    : hour >= settings.startHour || hour < settings.endHour;
}

export function requireWhatsAppWindow(lastInboundAt: string, now: Date): void {
  const age = now.getTime() - Date.parse(lastInboundAt);
  if (!Number.isFinite(age) || age < 0 || age >= 86_400_000)
    throw new MarketingError("marketing_service_window_expired", 409);
}

export function validateMarketingCampaign(
  input: Pick<
    MarketingCampaign,
    | "name"
    | "body"
    | "budgetCents"
    | "maxUnitCostCents"
    | "language"
    | "segment"
  >
): void {
  if (
    !input.name.trim() ||
    input.name.length > 120 ||
    !input.body.trim() ||
    input.body.length > 1024 ||
    /{{|}}/.test(input.body) ||
    !/^[a-z]{2}_[A-Z]{2}$/.test(input.language) ||
    !Number.isSafeInteger(input.budgetCents) ||
    input.budgetCents < 1 ||
    !Number.isSafeInteger(input.maxUnitCostCents) ||
    input.maxUnitCostCents < 1 ||
    input.budgetCents < input.maxUnitCostCents
  )
    throw new MarketingError("marketing_campaign_invalid");
  if (input.segment.stage && !MARKETING_STAGES.includes(input.segment.stage))
    throw new MarketingError("marketing_segment_invalid");
  if (
    input.segment.origin &&
    !["site", "whatsapp", "unknown"].includes(input.segment.origin)
  )
    throw new MarketingError("marketing_segment_invalid");
  if (
    input.segment.buyer &&
    !["lead", "customer"].includes(input.segment.buyer)
  )
    throw new MarketingError("marketing_segment_invalid");
  if (input.segment.interest && input.segment.interest.length > 120)
    throw new MarketingError("marketing_segment_invalid");
}

export function marketingConsentGranted(
  consent: MarketingConsent | null
): boolean {
  return consent?.status === "granted";
}

export function marketingDeliveryTransition(
  current: MarketingDeliveryStatus,
  incoming: MarketingDeliveryStatus
): MarketingDeliveryStatus {
  const order: Partial<Record<MarketingDeliveryStatus, number>> = {
    queued: 0,
    sending: 1,
    unknown: 1,
    accepted: 2,
    delivered: 3,
    read: 4,
  };
  if (current === "read" || (current === "delivered" && incoming === "failed"))
    return current;
  if (incoming === "failed")
    return current === "suppressed" ? current : "failed";
  return (order[incoming] ?? -1) > (order[current] ?? -1) ? incoming : current;
}

export function canMarketingAiMove(
  contact: MarketingContact,
  next: MarketingStage
): boolean {
  return next === "interested" && contact.stage === "new";
}
