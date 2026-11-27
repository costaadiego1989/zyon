import { dashboardJson } from "./http/client.js";

export const marketingStages = [
  "new",
  "interested",
  "shopping",
  "payment_pending",
  "purchased",
  "lost",
] as const;
export type MarketingStage = (typeof marketingStages)[number];
export const marketingStageLabels: Record<MarketingStage, string> = {
  new: "Novo contato",
  interested: "Interessado",
  shopping: "Em compra",
  payment_pending: "Pagamento pendente",
  purchased: "Compra confirmada",
  lost: "Sem conversão",
};
export interface MarketingContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  accountId: string | null;
  origin: "site" | "whatsapp" | "unknown";
  channels: Array<"site" | "whatsapp">;
  stage: MarketingStage;
  stageAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  version: number;
  purchaseCount: number;
  totalSpentCents: number;
  lastPurchaseAt: string | null;
  interests: string[];
}
export interface MarketingConversation {
  id: string;
  contactId: string | null;
  channel: "site" | "whatsapp" | "unknown";
  mode: "ai" | "human";
  assignedUserId: string | null;
  version: number;
  lastInboundAt: string;
  updatedAt: string;
  contactName?: string | null;
  phoneTail?: string | null;
}
export interface MarketingMessage {
  id: string;
  role: "buyer" | "ai" | "agent" | "system";
  content: string;
  createdAt: string;
  status:
    | "queued"
    | "sending"
    | "accepted"
    | "delivered"
    | "read"
    | "failed"
    | "suppressed"
    | "unknown"
    | "recorded";
  sequence?: string;
  authorId: string | null;
}
export interface MarketingConversationDetail {
  conversation: MarketingConversation;
  messages: MarketingMessage[];
  contact: MarketingContact | null;
  hasMore: boolean;
  before: string | null;
}
export interface MarketingContactDetail {
  contact: MarketingContact;
  consent: {
    status: "granted" | "declined" | "revoked";
    recordedAt: string;
    source: string;
  } | null;
  timeInStageMs: number;
  history: Array<{
    id: string;
    from: MarketingStage;
    to: MarketingStage;
    author: "agent" | "ai" | "business";
    reason: string;
    occurredAt: string;
  }>;
  activity: {
    conversationCount: number;
    messageCount: number;
    conversations: MarketingConversation[];
  };
}
export interface MarketingFunnel {
  total: number;
  rows: Array<{
    stage: MarketingStage;
    origin: MarketingContact["origin"];
    total: number;
  }>;
}
export interface MarketingCampaignDraft {
  name: string;
  body: string;
  segment: {
    stage?: MarketingStage;
    origin?: MarketingContact["origin"];
    buyer?: "lead" | "customer";
    interest?: string;
  };
  budgetCents: number;
  maxUnitCostCents: number;
  language?: string;
}
export interface MarketingCampaign extends MarketingCampaignDraft {
  id: string;
  status:
    | "draft"
    | "approved"
    | "scheduled"
    | "running"
    | "paused"
    | "completed";
  version: number;
  approvedVersion: number | null;
  templateName: string | null;
  templateStatus: string;
  approvedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  reservedCents: number;
  pauseReason?: string;
  audience?: {
    selected: number;
    eligible: number;
    excluded: Record<string, number>;
  };
}
export interface MarketingCampaignReview {
  selected: number;
  eligible: number;
  excluded: Record<string, number>;
  estimatedReservationCents: number;
  budgetSufficient: boolean;
  templateStatus: string;
  settingsConfigured: boolean;
}
export interface MarketingCampaignReport {
  campaign: MarketingCampaign;
  counts: Record<string, number>;
  selected: number;
  eligible: number;
  excluded: Record<string, number>;
  reservedCents: number;
  attributedRevenueCents: null | number;
}
export interface MarketingSettings {
  timezone: string;
  startHour: number;
  endHour: number;
  minIntervalHours: number;
  maxMessagesPerDay: number;
  retentionDays: number;
  configured: boolean;
}
export interface MarketingPage<T> {
  items: T[];
  total: number;
}
export interface MarketingFilters {
  search?: string;
  channel?: string;
  stage?: string;
  origin?: string;
  buyer?: string;
  limit?: number;
  offset?: number;
}
export function marketingApi(base: string) {
  const get = <T>(path: string) => dashboardJson<T>(base, `/marketing${path}`);
  const write = <T>(path: string, method: string, body: unknown = {}) =>
    dashboardJson<T>(base, `/marketing${path}`, { method, jsonBody: body });
  return {
    access: () => get<{ enabled: boolean; minimumPlan: "growth" }>("/access"),
    history: async () => {
      const job = await get<MarketingHistoryJob | null>("/history");
      return job?.status ? job : null;
    },
    importHistory: () => write<MarketingHistoryJob>("/history", "POST"),
    retention: () => get<{ eligible: number; before: string }>("/retention"),
    campaigns: () => get<MarketingCampaign[]>("/campaigns"),
    campaign: (id: string) =>
      get<MarketingCampaign>(`/campaigns/${encodeURIComponent(id)}`),
    createCampaign: (body: MarketingCampaignDraft) =>
      write<MarketingCampaign>("/campaigns", "POST", body),
    updateCampaign: (
      id: string,
      body: MarketingCampaignDraft,
      version: number
    ) =>
      write<MarketingCampaign>(
        `/campaigns/${encodeURIComponent(id)}`,
        "PATCH",
        { ...body, version }
      ),
    submitTemplate: (id: string) =>
      write<MarketingCampaign>(
        `/campaigns/${encodeURIComponent(id)}/template`,
        "POST"
      ),
    syncTemplate: (id: string) =>
      write<MarketingCampaign>(
        `/campaigns/${encodeURIComponent(id)}/template/sync`,
        "POST"
      ),
    review: (id: string) =>
      get<MarketingCampaignReview>(
        `/campaigns/${encodeURIComponent(id)}/review`
      ),
    approve: (id: string, version: number) =>
      write<MarketingCampaign>(
        `/campaigns/${encodeURIComponent(id)}/approve`,
        "POST",
        { version }
      ),
    schedule: (id: string, scheduledAt?: string) =>
      write<MarketingCampaign>(
        `/campaigns/${encodeURIComponent(id)}/schedule`,
        "POST",
        { scheduledAt }
      ),
    pause: (id: string) =>
      write<MarketingCampaign>(
        `/campaigns/${encodeURIComponent(id)}/pause`,
        "POST"
      ),
    report: (id: string) =>
      get<MarketingCampaignReport>(
        `/campaigns/${encodeURIComponent(id)}/report`
      ),
    settings: async () => {
      const settings = await get<MarketingSettings | null>("/settings");
      return settings?.configured ? settings : null;
    },
    configure: (body: Omit<MarketingSettings, "configured">) =>
      write<MarketingSettings>("/settings", "PATCH", body),
    conversations: (filters: {
      search?: string;
      channel?: string;
      mode?: string;
      assignment?: string;
      limit?: number;
      offset?: number;
    }) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined && value !== "") params.set(key, String(value));
      return get<MarketingPage<MarketingConversation>>(
        `/conversations?${params}`
      );
    },
    conversation: (id: string, before?: string) =>
      get<MarketingConversationDetail>(
        `/conversations/${encodeURIComponent(id)}${
          before ? `?before=${encodeURIComponent(before)}` : ""
        }`
      ),
    ownership: (id: string, action: "claim" | "release", version: number) =>
      write<MarketingConversation>(
        `/conversations/${encodeURIComponent(id)}/ownership`,
        "POST",
        { action, version }
      ),
    reply: (id: string, content: string, requestId: string, version: number) =>
      write<{ message: MarketingMessage; conversation: MarketingConversation }>(
        `/conversations/${encodeURIComponent(id)}/messages`,
        "POST",
        { content, requestId, version }
      ),
    contacts: (filters: MarketingFilters) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value !== undefined && value !== "") params.set(key, String(value));
      return get<MarketingPage<MarketingContact>>(`/contacts?${params}`);
    },
    contact: (id: string) =>
      get<MarketingContactDetail>(`/contacts/${encodeURIComponent(id)}`),
    funnel: () => get<MarketingFunnel>("/funnel"),
    move: (
      id: string,
      stage: MarketingStage,
      reason: string,
      version: number
    ) =>
      write<MarketingContact>(
        `/contacts/${encodeURIComponent(id)}/stage`,
        "PATCH",
        { stage, reason, version }
      ),
    optOut: (id: string) =>
      write<void>(`/contacts/${encodeURIComponent(id)}/opt-out`, "POST"),
  };
}
export interface MarketingHistoryJob {
  status: "queued" | "running" | "completed" | "failed";
  phase: "whatsapp" | "buyers" | "orders";
  records: number;
  messages: number;
  reason: string | null;
  updatedAt: string;
}
