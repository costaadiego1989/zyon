import type { BillingPromotion, BillingPromotionDraft, BillingPromotionsPage, BillingPromotionsQuery } from "./billing-promotions.js";

export type PlatformOperatorRole =
  | "platform_admin"
  | "billing_ops"
  | "support_ops"
  | "infra_ops"
  | "auditor";

export type PlatformOperator = {
  operator_id: string;
  email: string;
  role: PlatformOperatorRole;
};

export type PlatformOperatorDirectoryStatus = "active" | "disabled";

export type PlatformOperatorDirectoryEntry = PlatformOperator & {
  permissions: string[];
  status: PlatformOperatorDirectoryStatus;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformOperatorDirectoryPage = {
  generated_at: string;
  summary: {
    total: number;
    active: number;
    disabled: number;
  };
  items: PlatformOperatorDirectoryEntry[];
  next_cursor: string | null;
};

export type PlatformOperatorDirectoryQuery = {
  query?: string;
  role?: PlatformOperatorRole;
  status?: PlatformOperatorDirectoryStatus;
  cursor?: string;
  limit?: number;
};

export type PlatformOperatorAccessAction = "change_role" | "disable" | "enable" | "revoke_sessions";

export type PlatformOperatorAccessCommand = {
  action: PlatformOperatorAccessAction;
  role?: PlatformOperatorRole;
};

export type PlatformAuthResponse = PlatformOperator & {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export type FeedbackStatus = "new" | "acknowledged" | "planned" | "in_progress" | "resolved" | "declined";
export type FeedbackPriority = "low" | "normal" | "high" | "critical";

export type PlatformFeedback = {
  id: string;
  merchantId: string;
  merchantName?: string;
  authorUserId: string;
  authorEmail?: string;
  category: "bug" | "improvement" | "suggestion" | "other" | string;
  message: string;
  createdAt: string;
  treatment: {
    status: FeedbackStatus;
    priority: FeedbackPriority;
    assignedOperatorId?: string;
    assignedOperatorEmail?: string;
    firstReadAt?: string;
    resolvedAt?: string;
    updatedAt?: string;
    latestNote?: {
      id: string;
      operatorId: string;
      operatorEmail?: string;
      message: string;
      createdAt: string;
    };
    notes?: Array<{
      id: string;
      operatorId: string;
      operatorEmail?: string;
      message: string;
      createdAt: string;
    }>;
    auditHistory?: Array<{
      id: string;
      actorOperatorId?: string;
      actorOperatorEmail?: string;
      occurredAt: string;
      previous: {
        status?: FeedbackStatus;
        priority?: FeedbackPriority;
        assignedOperatorId?: string | null;
      };
      current: {
        status?: FeedbackStatus;
        priority?: FeedbackPriority;
        assignedOperatorId?: string | null;
      };
      noteAdded: boolean;
    }>;
  };
};

export type PlatformFeedbackPage = {
  items: PlatformFeedback[];
  nextCursor?: string;
};

export type PlatformOverviewSourceId =
  | "merchant_registry"
  | "subscriptions"
  | "receivables"
  | "delinquency"
  | "due_dates"
  | "ai_chat"
  | "ai_voice"
  | "infrastructure";

export type PlatformOverviewSource = {
  status: "available" | "partial" | "unavailable";
  description: string;
};

export type PlatformOverview = {
  generated_at: string;
  scope: {
    environment: string;
    data_freshness: "read_through_database" | string;
  };
  sources: Record<PlatformOverviewSourceId, PlatformOverviewSource>;
  merchants: {
    registered: number;
    active_users: number;
  };
  subscriptions: {
    records_by_status: Record<string, number>;
    active_records: number;
    active_trials: number;
  };
  receivables: {
    as_of: string;
    currency: "BRL";
    observed_receivables: number;
    observed_since: string | null;
    financial_metrics_available: boolean;
    open_count: number | null;
    open_known_balance_cents: string | null;
    overdue_count: number | null;
    overdue_merchant_count: number | null;
    overdue_known_balance_cents: string | null;
    due_today_count: number | null;
    due_next_7_days_count: number | null;
    next_due_at: string | null;
    confirmed_payment_count_since_capture: number | null;
    confirmed_payment_known_amount_cents_since_capture: string | null;
    incomplete_amount_count: number | null;
    incomplete_due_date_count: number | null;
  };
  ai_chat: {
    period_started_at: string;
    usage_events: number;
    total_tokens: number;
    priced_usage_events: number;
    unpriced_usage_events: number;
    known_cost_micros: string;
    currency: "USD";
  };
  feedback: {
    received: number;
  };
  infrastructure: {
    readiness: "ready" | "unavailable";
    database: string;
    redis: string;
  };
};

export type PlatformMetricsGranularity = "day" | "month";

export type PlatformMetricCost = {
  status: "estimated" | "provider_reported" | "reconciled";
  currency: string;
  cost_micros: string;
  event_count: string;
};

export type PlatformMetrics = {
  generated_at: string;
  period: {
    from: string;
    to: string;
    timezone: "America/Sao_Paulo";
    granularity: PlatformMetricsGranularity;
    end_exclusive: true;
  };
  coverage: {
    financial: { status: "partial" | "unavailable"; observed_receivables: number; observed_since: string | null; description: string };
    subscriptions: { status: "partial"; description: string };
    ai: { status: "partial"; description: string };
    platform_fees: { status: "unavailable"; description: string };
  };
  financial: {
    currency: "BRL";
    received: null | {
      confirmed_payment_count: string;
      confirmed_known_amount_cents: string;
      incomplete_amount_count: string;
      series: Array<{
        bucket: string;
        confirmed_payment_count: string;
        confirmed_known_amount_cents: string;
        incomplete_amount_count: string;
      }>;
    };
    current_position: null | {
      as_of: string;
      open_count: number;
      open_known_balance_cents: string | null;
      overdue_count: number;
      overdue_merchant_count: number;
      overdue_known_balance_cents: string | null;
      due_today_count: number;
      due_next_7_days_count: number;
      next_due_at: string | null;
    };
    contracted_mrr: {
      active_contract_count: number;
      active_contract_with_known_amount_count: number;
      active_contract_missing_amount_count: number;
      known_amount_cents: string;
      caveat: "active_local_contracts_normalized_to_monthly_and_rounded_to_cent";
    };
  };
  ai: {
    chat: { event_count: string; total_tokens: string; unpriced_event_count: string; costs: PlatformMetricCost[] };
    voice: { event_count: string; total_tokens: string; unpriced_event_count: string; costs: PlatformMetricCost[] };
    series: Array<{
      bucket: string;
      chat_event_count: string;
      voice_event_count: string;
      chat_total_tokens: string;
      voice_total_tokens: string;
      costs: Array<PlatformMetricCost & { channel: "chat" | "voice" }>;
    }>;
  };
};
export type PlatformMerchant = {
  id: string;
  name: string;
  store_slug?: string;
  store_category?: string;
  plan: "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH" | "API";
  member_count: number;
  created_at: string;
  updated_at: string;
};

export type PlatformMerchantPage = {
  items: PlatformMerchant[];
  next_cursor?: string;
};

export type PlatformBillingSubscriptionStatus =
  | "trialing"
  | "starter"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "cancelled"
  | "incomplete";

export type PlatformBillingSubscriptionProvider = "asaas" | "stripe" | "mercadopago" | "unknown";

export type PlatformBillingSubscriptionQuery = {
  cursor?: string;
  limit?: number;
  status?: PlatformBillingSubscriptionStatus;
  provider?: PlatformBillingSubscriptionProvider;
};

export type PlatformBillingSource = {
  status: "partial" | "unavailable";
  description: string;
};

export type PlatformBillingSubscription = {
  merchant_id: string;
  merchant_name: string;
  provider: PlatformBillingSubscriptionProvider;
  status: PlatformBillingSubscriptionStatus;
  plan_key: "starter" | "growth" | "scale" | null;
  billing_cycle: "monthly" | "annual";
  billing_amount_cents: number | null;
  term_ends_at: string | null;
  term_end_kind: "trial" | "billing_period" | null;
  cancel_at_period_end: boolean;
  provider_cancellation_scheduled_at: string | null;
  last_billing_event_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformBillingSubscriptionsPage = {
  generated_at: string;
  sources: {
    subscription_state: PlatformBillingSource;
    receivables: PlatformBillingSource;
    delinquency: PlatformBillingSource;
    next_due_date: PlatformBillingSource;
  };
  summary: {
    total_records: number;
    records_by_status: Record<string, number>;
    active_local_records: number;
    active_trials: number;
    past_due_local_state_records: number;
    cancellation_at_period_end_records: number;
    missing_term_end_records: number;
  };
  items: PlatformBillingSubscription[];
  next_cursor: string | null;
};

export type PlatformBillingReceivableStatus = "open" | "overdue" | "paid" | "cancelled" | "refunded";

export type PlatformBillingReceivable = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  provider: "asaas" | "stripe" | "mercadopago";
  provider_payment_id: string;
  provider_subscription_id: string;
  provider_status: PlatformBillingReceivableStatus;
  is_overdue_as_of: boolean;
  currency: string;
  amount_cents: number | null;
  due_at: string | null;
  paid_at: string | null;
  first_observed_at: string;
  last_provider_event_at: string;
};

export type PlatformBillingReceivablesPage = {
  generated_at: string;
  as_of: string;
  sources: {
    asaas_subscription_charges: PlatformBillingSource;
    stripe_subscription_charges: PlatformBillingSource;
    mercadopago_subscription_charges: PlatformBillingSource;
    reconciliation: PlatformBillingSource;
  };
  coverage: {
    observed_receivables: number;
    observed_since: string | null;
    financial_metrics_available: boolean;
    currency: "BRL";
  };
  summary: {
    open_count: number | null;
    open_balance_cents: string | null;
    overdue_count: number | null;
    overdue_merchant_count: number | null;
    overdue_balance_cents: string | null;
    due_today_count: number | null;
    due_today_balance_cents: string | null;
    due_next_7_days_count: number | null;
    due_next_7_days_balance_cents: string | null;
    next_due_at: string | null;
    confirmed_payment_count_since_capture: number | null;
    confirmed_payment_amount_cents_since_capture: string | null;
    incomplete_amount_count: number | null;
    incomplete_due_date_count: number | null;
  };
  items: PlatformBillingReceivable[];
  next_cursor: string | null;
};

export type PlatformAiUsageMerchant = {
  merchant_id: string;
  merchant_name?: string;
  chat: {
    event_count: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
  };
  voice: {
    component_event_count: string;
    response_count: string;
    session_count: string;
    failed_response_count: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
  };
  costs: {
    estimated: {
      event_count: string;
      by_currency: Array<{
        currency: string;
        cost_micros: string;
        event_count: string;
      }>;
      caveat: "estimated_price_version_not_provider_invoice";
    };
    provider_reported: {
      event_count: string;
      by_currency: Array<{
        currency: string;
        cost_micros: string;
        event_count: string;
      }>;
      caveat: "provider_reported_event_cost_not_reconciled_invoice";
    };
    reconciled: {
      event_count: string;
      by_currency: Array<{
        currency: string;
        cost_micros: string;
        event_count: string;
      }>;
      caveat: "provider_reconciliation_reference_recorded";
    };
    unpriced: {
      event_count: string;
      total_tokens: string;
      caveat: "no_effective_price_version";
    };
    other_cost_status_event_count: string;
  };
};

export type PlatformAiUsageByMerchant = {
  period: {
    from: string;
    to: string;
    timezone: "UTC";
    end_exclusive: boolean;
  };
  coverage: {
    chat: {
      status: "available";
      attribution: "server_captured";
      source: "storefront_langgraph";
      channel: "chat";
      component: "text_generation";
      execution_status: "succeeded";
    };
    voice: {
      status: "partial";
      attribution: "client_forwarded_provider_event";
      source: "openai_realtime_client_forwarded";
      provider: "openai";
      channel: "voice";
      caveat: "browser_forwarded_usage_requires_provider_invoice_reconciliation";
    };
    costs: {
      status: "partial";
      estimated: "versioned_price_estimate_not_provider_invoice";
      reconciled: "trusted_server_provider_invoice_or_export_value";
      unpriced: "events_without_effective_price_version_are_counted_separately";
    };
  };
  items: PlatformAiUsageMerchant[];
};

export type PlatformAuditQuery = {
  cursor?: string;
  limit?: number;
  action?: string;
  actor_operator_id?: string;
  from?: string;
  to?: string;
};

export type PlatformAuditEvent = {
  id: string;
  occurred_at: string;
  action: string;
  outcome: string;
  actor_operator_id?: string;
  actor_operator_email?: string;
  actor_operator_role?: string;
  permission: string;
  environment: string;
  target_type: string;
  target_id?: string;
  correlation_id: string;
  details?: Record<string, string | number | boolean>;
};

export type PlatformAuditPage = {
  generated_at: string;
  filters: {
    action: string | null;
    actor_operator_id: string | null;
    range: {
      from: string;
      to: string;
      timezone: "UTC";
      end_exclusive: true;
    } | null;
  };
  coverage: {
    audit_event_storage: {
      status: "available";
      description: string;
    };
  };
  items: PlatformAuditEvent[];
  next_cursor: string | null;
};

export type PlatformInfrastructureReadinessCoverage = {
  status: "available" | "unavailable";
  description: string;
};

export type PlatformInfrastructureQueueStatus = "available" | "degraded" | "unavailable" | "not_configured";

export type PlatformInfrastructureQueue = {
  key: string;
  queue: string;
  description: string;
  status: "available" | "unavailable";
  counts?: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    paused: number;
    prioritized: number;
  };
};

export type PlatformInfrastructureConnectionState = {
  surface: "commerce" | "payments" | "erp" | "crm";
  provider: string;
  status: string;
  count: number;
};

export type PlatformInfrastructureIncident = {
  id: string;
  severity: "critical" | "warning";
  source: "readiness" | "queue" | "integration";
  title: string;
  description: string;
};

export type PlatformInfrastructureIncidentHistory = {
  status: "available" | "unavailable";
  source: "platform_audit_snapshot";
  items?: Array<PlatformInfrastructureIncident & {
    firstObservedAt: string;
    lastObservedAt: string;
    observations: number;
    state: "present_in_current_read" | "not_present_in_current_read";
  }>;
};
export type PlatformInfrastructureReadiness = {
  generated_at: string;
  coverage: {
    readiness: PlatformInfrastructureReadinessCoverage;
    queues: PlatformInfrastructureReadinessCoverage;
    external_integrations: PlatformInfrastructureReadinessCoverage;
    incident_history: PlatformInfrastructureReadinessCoverage;
  };
  readiness: {
    status: "ready" | "unavailable";
    database: "connected" | "disconnected";
    redis: "connected" | "disconnected" | "not_configured";
  };
  queues: {
    status: PlatformInfrastructureQueueStatus;
    source: "bullmq";
    queues: PlatformInfrastructureQueue[];
  };
  external_integrations: {
    status: "available" | "unavailable";
    source: "persisted_connection_state";
    connection_states?: PlatformInfrastructureConnectionState[];
    erp_sync_jobs?: Array<{ status: string; count: number }>;
  };
  current_alerts: PlatformInfrastructureIncident[];
  incident_history: PlatformInfrastructureIncidentHistory;
};

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

export type PlatformOrder = {
  id: string;
  externalOrderId: string;
  merchant: { id: string; name: string; storeSlug?: string };
  totalMinor: number;
  currency: string;
  status: string;
  payment: { method: string; status: string; provider?: string };
  shipping: { status?: string; carrier?: string };
  completedAt: string;
};
export type PlatformOrderDetail = PlatformOrder & {
  customer?: { name?: string; email?: string; phone?: string };
  items: Array<{ name: string; sku?: string; variant?: string; quantity: number; unitPriceMinor?: number; totalMinor?: number }>;
  payment: PlatformOrder["payment"] & { amountMinor?: number; providerPaymentReference?: string; updatedAt?: string };
  shipping: PlatformOrder["shipping"] & { amountMinor?: number; trackingCode?: string; trackingUrl?: string; estimatedEta?: string; deliveredAt?: string; address?: { street?: string; number?: string; complement?: string; neighborhood?: string; city?: string; state?: string; postalCode?: string } };
  cancelledAt?: string;
  cancellationReason?: string;
};
export type PlatformOrdersPage = { items: PlatformOrder[]; nextCursor?: string };
export type PlatformMerchantDetail = {
  merchant: { id: string; name: string; storeSlug?: string; storeCategory?: string; plan: string; createdAt: string };
  period: { from: string; to: string };
  orders: { allTimeCount: number; allTimeTotalMinor: number; periodCount: number; periodTotalMinor: number; series: Array<{ date: string; orderCount: number; totalMinor: number }> };
  billing: { status?: string; provider?: string; planKey?: string; amountMinor?: number; cycle?: string; currentPeriodEnd?: string; overdueCount: number; openReceivableCount: number; nextDueAt?: string };
  ai: { chatTokens: string; voiceTokens: string; chatKnownCostMicros: string; voiceKnownCostMicros: string; knownCostMicros: string; unpricedEvents: number };
  recentOrders: PlatformOrder[];
};
export type PlatformMerchantRanking = { rank: number; merchant: { id: string; name: string; storeSlug?: string }; sales: { orderCount: number; totalMinor: number }; ai: { totalTokens: string; knownCostMicros: string; unpricedEvents: number } };
export type PlatformMerchantRankings = { period: { from: string; to: string }; sort: "sales" | "ai_cost" | "tokens"; items: PlatformMerchantRanking[] };
export class PlatformApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message?: string,
  ) {
    super(message ?? "Não foi possível concluir a solicitação.");
    this.name = "PlatformApiError";
  }
}

export function resolvePlatformApiBaseUrl(env: ImportMetaEnv): string {
  const configured = env.VITE_PLATFORM_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://localhost:3001";
  throw new Error("VITE_PLATFORM_API_BASE_URL is required for control runtime.");
}

import { createPlatformSupportClient } from "@zyon/platform-support-ui";

export class PlatformApi {
  private sessionToken: string | undefined;
  private sessionExpiresAt: number | undefined;
  private sessionVersion = 0;
  private sessionEnded = false;
  private refreshing: Promise<string> | undefined;

  constructor(private readonly baseUrl: string, private readonly session: {
    token?: string;
    onRefreshed?(response: PlatformAuthResponse): void;
    onExpired?(): void;
  } = {}) {
    this.sessionToken = session.token;
  }

  /** Also called on focus/resume, when background timers may have been suspended. */
  async renewSession(): Promise<void> {
    if (this.sessionToken && !this.sessionEnded) await this.validToken(this.sessionToken);
  }
  getAiGovernance(token:string,filters:Record<string,string>) {
    return this.request<import("./ai-governance.js").GovernanceReport>("/platform/ai-governance?"+new URLSearchParams(filters),token);
  }
  getAiPolicy(token:string,merchantId:string) {
    return this.request<import("./ai-governance.js").GovernancePolicy>("/platform/ai-governance/"+encodeURIComponent(merchantId)+"/policy",token);
  }
  saveAiGovernance(token:string,merchantId:string,section:"policy"|"team"|"baseline",value:unknown) {
    return this.request("/platform/ai-governance/"+encodeURIComponent(merchantId)+"/"+section,token,{method:"PUT",body:JSON.stringify(value)});
  }
  observeAiTask(token:string,merchantId:string,taskId:string,humanMs:number) {
    return this.request("/platform/ai-governance/"+encodeURIComponent(merchantId)+"/tasks/"+encodeURIComponent(taskId)+"/human-time",token,
      {method:"POST",body:JSON.stringify({humanMs})});
  }
  getAiCosts(token: string, filters: import("./ai-costs.js").AiCostFilters) {
    return this.request<import("./ai-costs.js").AiCostsReport>("/platform/ai-costs?"+new URLSearchParams(filters),token);
  }
  getAiCostEvents(token: string, filters: import("./ai-costs.js").AiCostFilters) {
    return this.request<import("./ai-costs.js").AiCostEvents>("/platform/ai-costs/events?"+new URLSearchParams(filters),token);
  }
  async exportAiCosts(token: string, filters: import("./ai-costs.js").AiCostFilters) {
    const response=await this.authenticatedFetch("/platform/ai-costs/export?"+new URLSearchParams(filters),token);
    if(!response.ok) throw new PlatformApiError(response.status,"ai_costs_export_failed","Não foi possível exportar o consumo.");
    return response.blob();
  }

  supportClient(token: string) {
    return createPlatformSupportClient({ baseUrl: this.baseUrl, kind: "operator", token,
      request: <T>(path: string, options?: RequestOptions) => this.request<T>(path, token, options),
    });
  }

  async listBillingPromotions(token: string, filters: BillingPromotionsQuery): Promise<BillingPromotionsPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
    return this.request<BillingPromotionsPage>(`/platform/billing/promotions?${query}`, token);
  }

  async createBillingPromotion(token: string, input: BillingPromotionDraft): Promise<BillingPromotion> {
    return this.request<BillingPromotion>("/platform/billing/promotions", token, { method: "POST", body: JSON.stringify(input) });
  }

  async toggleBillingPromotion(token: string, id: string, enabled: boolean): Promise<BillingPromotion> {
    return this.request<BillingPromotion>(`/platform/billing/promotions/${encodeURIComponent(id)}`, token, { method: "PATCH", body: JSON.stringify({ enabled }) });
  }

  async retryBillingPromotion(token: string, id: string): Promise<BillingPromotion> {
    return this.request<BillingPromotion>(`/platform/billing/promotions/${encodeURIComponent(id)}/retry`, token, { method: "POST" });
  }

  async updateBillingPromotion(token: string, input: BillingPromotionDraft): Promise<BillingPromotion> {
    return this.request<BillingPromotion>(`/platform/billing/promotions/${encodeURIComponent(input.id)}`, token, { method: "PUT", body: JSON.stringify(input) });
  }

  async deleteBillingPromotion(token: string, id: string): Promise<void> {
    await this.request(`/platform/billing/promotions/${encodeURIComponent(id)}`, token, { method: "DELETE" });
  }

  async login(email: string, password: string): Promise<PlatformAuthResponse> {
    const response = await this.request<PlatformAuthResponse>("/platform/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.sessionVersion++;
    this.sessionEnded = false;
    this.sessionToken = response.access_token;
    this.sessionExpiresAt = Date.now() + response.expires_in * 1000;
    return response;
  }

  async me(token: string): Promise<PlatformOperator> {
    return this.request<PlatformOperator>("/platform/auth/me", token);
  }

  async logout(token: string): Promise<void> {
    // Finish an in-flight rotation before revoking its replacement session.
    try { await this.refreshing; } catch { /* Revoke the last known token below. */ }
    const current = this.sessionToken ?? token;
    this.sessionVersion++;
    this.sessionEnded = true;
    this.sessionToken = undefined;
    this.sessionExpiresAt = undefined;
    const response = await this.fetchResponse("/platform/auth/logout", current, { method: "POST" });
    if (!response.ok) throw new PlatformApiError(response.status, "platform_logout_failed");
  }

  async getOverview(token: string): Promise<PlatformOverview> {
    return this.request<PlatformOverview>("/platform/overview", token);
  }

  async getMetrics(
    token: string,
    filters: { from?: string; to?: string; granularity?: PlatformMetricsGranularity } = {},
  ): Promise<PlatformMetrics> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.granularity) query.set("granularity", filters.granularity);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformMetrics>(`/platform/overview/metrics${suffix}`, token);
  }
  async listOperators(
    token: string,
    filters: PlatformOperatorDirectoryQuery = {},
  ): Promise<PlatformOperatorDirectoryPage> {
    const query = new URLSearchParams();
    if (filters.query?.trim()) query.set("query", filters.query.trim());
    if (filters.role) query.set("role", filters.role);
    if (filters.status) query.set("status", filters.status);
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
        throw new RangeError("O limite de operadores deve ser um número inteiro entre 1 e 100.");
      }
      query.set("limit", String(filters.limit));
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformOperatorDirectoryPage>(`/platform/operators${suffix}`, token);
  }

  async manageOperatorAccess(
    token: string,
    operatorId: string,
    input: PlatformOperatorAccessCommand,
  ): Promise<PlatformOperatorDirectoryEntry> {
    return this.request<PlatformOperatorDirectoryEntry>("/platform/operators/" + encodeURIComponent(operatorId) + "/access", token, {
      method: "PATCH",
      body: JSON.stringify({
        action: input.action,
        ...(input.role ? { role: input.role } : {}),
      }),
    });
  }

  async listMerchants(
    token: string,
    filters: { query?: string; cursor?: string },
  ): Promise<PlatformMerchantPage> {
    const query = new URLSearchParams();
    if (filters.query) query.set("query", filters.query);
    if (filters.cursor) query.set("cursor", filters.cursor);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformMerchantPage>(`/platform/merchants${suffix}`, token);
  }

  async listOrders(token: string, filters: { from?: string; to?: string; status?: string; merchantId?: string; query?: string; cursor?: string; limit?: number } = {}): Promise<PlatformOrdersPage> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.status) query.set("status", filters.status);
    if (filters.merchantId) query.set("merchant_id", filters.merchantId);
    if (filters.query?.trim()) query.set("query", filters.query.trim());
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformOrdersPage>(`/platform/orders${suffix}`, token);
  }

  async getOrder(token: string, orderId: string): Promise<PlatformOrderDetail> {
    return this.request<PlatformOrderDetail>(`/platform/orders/${encodeURIComponent(orderId)}`, token);
  }

  async getMerchantDetail(token: string, merchantId: string, filters: { from?: string; to?: string } = {}): Promise<PlatformMerchantDetail> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformMerchantDetail>(`/platform/merchants/${encodeURIComponent(merchantId)}/detail${suffix}`, token);
  }

  async getMerchantRankings(token: string, filters: { from?: string; to?: string; sort?: "sales" | "ai_cost" | "tokens"; limit?: number } = {}): Promise<PlatformMerchantRankings> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.sort) query.set("sort", filters.sort);
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformMerchantRankings>(`/platform/merchant-rankings${suffix}`, token);
  }
  async listBillingSubscriptions(
    token: string,
    filters: PlatformBillingSubscriptionQuery = {},
  ): Promise<PlatformBillingSubscriptionsPage> {
    const query = new URLSearchParams();
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.status) query.set("status", filters.status);
    if (filters.provider) query.set("provider", filters.provider);
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
        throw new RangeError("O limite de assinaturas deve ser um número inteiro entre 1 e 100.");
      }
      query.set("limit", String(filters.limit));
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformBillingSubscriptionsPage>(`/platform/billing/subscriptions${suffix}`, token);
  }

  async listBillingReceivables(
    token: string,
    filters: { cursor?: string; limit?: number; status?: PlatformBillingReceivableStatus } = {},
  ): Promise<PlatformBillingReceivablesPage> {
    const query = new URLSearchParams();
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.status) query.set("status", filters.status);
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
        throw new RangeError("O limite de recebíveis deve ser um número inteiro entre 1 e 100.");
      }
      query.set("limit", String(filters.limit));
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformBillingReceivablesPage>(`/platform/billing/receivables${suffix}`, token);
  }

  async getAiUsageByMerchant(
    token: string,
    filters: { from?: string; to?: string; limit?: number } = {},
  ): Promise<PlatformAiUsageByMerchant> {
    const query = new URLSearchParams();
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformAiUsageByMerchant>(`/platform/ai-usage/merchants${suffix}`, token);
  }

  async listAudit(
    token: string,
    filters: PlatformAuditQuery = {},
  ): Promise<PlatformAuditPage> {
    const query = new URLSearchParams();
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.action) query.set("action", filters.action);
    if (filters.actor_operator_id) query.set("actor_operator_id", filters.actor_operator_id);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
        throw new RangeError("O limite de eventos deve ser um número inteiro entre 1 e 100.");
      }
      query.set("limit", String(filters.limit));
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformAuditPage>(`/platform/audit${suffix}`, token);
  }

  async getInfrastructureReadiness(token: string): Promise<PlatformInfrastructureReadiness> {
    return this.request<PlatformInfrastructureReadiness>("/platform/infrastructure/readiness", token);
  }

  async listFeedback(
    token: string,
    filters: { status?: FeedbackStatus; category?: string; cursor?: string },
  ): Promise<PlatformFeedbackPage> {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.category) query.set("category", filters.category);
    if (filters.cursor) query.set("cursor", filters.cursor);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<PlatformFeedbackPage>(`/platform/feedback${suffix}`, token);
  }

  async getFeedback(token: string, feedbackId: string): Promise<PlatformFeedback> {
    return this.request<PlatformFeedback>(`/platform/feedback/${encodeURIComponent(feedbackId)}`, token);
  }

  async updateFeedbackTreatment(
    token: string,
    feedbackId: string,
    input: {
      status?: FeedbackStatus;
      priority?: FeedbackPriority;
      assignedOperatorId?: string | null;
      note?: string;
    },
  ): Promise<PlatformFeedback> {
    return this.request<PlatformFeedback>(`/platform/feedback/${encodeURIComponent(feedbackId)}/treatment`, token, {
      method: "PATCH",
      body: JSON.stringify({
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assignedOperatorId !== undefined ? { assigned_operator_id: input.assignedOperatorId } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      }),
    });
  }

  private async request<T>(path: string, token?: string, options: RequestOptions = {}): Promise<T> {
    const response = token
      ? await this.authenticatedFetch(path, token, options)
      : await this.fetchResponse(path, undefined, options);

    if (response.status === 204) return undefined as T;
    const body = await readBody(response);
    if (!response.ok) {
      throw new PlatformApiError(response.status, errorCode(body), errorMessage(body));
    }
    return body as T;
  }

  private fetchResponse(path: string, token?: string, options: RequestOptions = {}): Promise<Response> {
    return fetch(mergeUrl(this.baseUrl, path), {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  }

  private async authenticatedFetch(path: string, token: string, options: RequestOptions = {}): Promise<Response> {
    const current = await this.validToken(token);
    const response = await this.fetchResponse(path, current, options);
    if (response.status !== 401) return response;
    // Another request may already have rotated the token that received this 401.
    const renewed = await this.validToken(current, true);
    return this.fetchResponse(path, renewed, options);
  }

  private async validToken(fallback: string, force = false): Promise<string> {
    if (this.sessionEnded) throw new PlatformApiError(401, "platform_session_ended");
    const token = this.sessionToken ?? fallback;
    if (this.refreshing) return this.refreshing;
    const needsRenewal = token === this.sessionToken && this.sessionExpiresAt !== undefined
      ? this.sessionExpiresAt <= Date.now() + 60_000
      : tokenNeedsRenewal(token);
    if (!(force && token === fallback) && !needsRenewal) return token;
    const version = this.sessionVersion;
    const pending = (async () => {
      const response = await this.fetchResponse("/platform/auth/refresh", token, {
        method: "POST", signal: AbortSignal.timeout(20_000),
      });
      const body = await readBody(response);
      if (!response.ok) {
        if (response.status === 401 && version === this.sessionVersion) {
          this.sessionEnded = true;
          this.sessionToken = undefined;
          this.session.onExpired?.();
        }
        throw new PlatformApiError(response.status, errorCode(body), errorMessage(body));
      }
      const refreshed = body as PlatformAuthResponse;
      if (!refreshed?.access_token || !refreshed.operator_id) throw new Error("invalid_platform_refresh_response");
      if (version !== this.sessionVersion || this.sessionEnded) throw new PlatformApiError(401, "platform_session_changed");
      this.sessionToken = refreshed.access_token;
      // Use the server's remaining lifetime so a clock difference does not
      // immediately expire a freshly rotated token in this browser.
      this.sessionExpiresAt = Date.now() + refreshed.expires_in * 1000;
      this.session.onRefreshed?.(refreshed);
      return refreshed.access_token;
    })();
    this.refreshing = pending;
    try { return await pending; }
    finally { if (this.refreshing === pending) this.refreshing = undefined; }
  }
}

function tokenNeedsRenewal(token: string): boolean {
  try {
    const part = token.split(".")[1]!;
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now() + 60_000;
  } catch {
    // Claims are only a scheduling hint. The API always verifies the signature.
    return true;
  }
}

function mergeUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trimEnd().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedBase.endsWith("/v1")
    ? `${normalizedBase}${normalizedPath}`
    : `${normalizedBase}/v1${normalizedPath}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function errorCode(body: unknown): string | undefined {
  return isObject(body) && typeof body.code === "string" ? body.code : undefined;
}

function errorMessage(body: unknown): string | undefined {
  if (!isObject(body)) return undefined;
  if (typeof body.detail === "string") return body.detail;
  if (typeof body.message === "string") return body.message;
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
