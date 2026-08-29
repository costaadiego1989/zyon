/**
 * All dashboard API types — domain models returned from endpoints.
 * Types from shared-types are re-exported for convenience.
 */
import type {
  CheckoutSettings,
  CheckoutSettingsPatch,
  DashboardOverview,
  MerchantRules,
  MerchantTheme,
  OnboardingStateResponse,
  OnboardingStepId,
  SupportSettings,
  SupportSettingsPatch,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketStatusPatch,
} from "@zyon/shared-types";

export type {
  CheckoutSettings,
  CheckoutSettingsPatch,
  DashboardOverview,
  MerchantRules,
  MerchantTheme,
  OnboardingStateResponse,
  OnboardingStepId,
  SupportSettings,
  SupportSettingsPatch,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketStatusPatch,
} from "@zyon/shared-types";

export type DashboardLoginAuth = {
  merchant_id: string;
  user_id: string;
  email: string;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export type DashboardRegisterPayload = {
  merchant_name: string;
  email: string;
  password: string;
  merchant_id?: string;
};

export type MerchantProfile = {
  id: string;
  name: string;
  plan?: "STORE_ONLY" | "BOTH" | "API";
};

export type NegotiationEvaluateBridgeResponse = Record<string, unknown> & {
  negotiation_session_id?: string;
};

export type MerchantApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CreatedMerchantApiKey = {
  api_key: MerchantApiKey;
  secret_key: string;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  signingSecret?: string;
  signingSecretHint?: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  eventType: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
};

export type TenantOrder = {
  id: string;
  session_id: string;
  external_order_id: string;
  status: string;
  total: number;
  currency: string;
  tracking_code: string | null;
  customer: Record<string, unknown> | null;
  cart: Record<string, unknown>;
  completed_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  payment_method: string | null;
  payment_provider: string | null;
  paid_at: string | null;
};

export type TenantCustomer = {
  id: string;
  profile: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
};

export type TenantPayment = {
  id: string;
  session_id: string;
  amount: number;
  approved_amount: number | null;
  currency: string;
  method: string;
  status: string;
  provider_reference: string | null;
  commerce_order_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BillingSubscription = {
  plan: "starter" | "growth" | "scale" | string;
  plan_name?: string;
  monthly_price_brl?: number;
  /** Fee do merchant por transação, fixo em centavos (sai do repasse). */
  transaction_fee_cents?: number;
  /** Taxa de serviço do buyer, fixo em centavos (somada ao total do pedido). */
  buyer_service_fee_cents?: number;
  limits?: Record<string, number | null>;
  features?: Record<string, boolean>;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  trial_ends_at?: string | null;
  usage?: {
    period_start?: string;
    orders_current?: number | null;
    orders_limit?: number | null;
    sessions_current: number | null;
    sessions_limit: number | null;
    ai_conversations_current?: number | null;
    ai_conversations_limit?: number | null;
    commerce_connections_current?: number | null;
    commerce_connections_limit?: number | null;
    webhook_endpoints_current?: number | null;
    webhook_endpoints_limit?: number | null;
    team_members_current?: number | null;
    team_members_limit?: number | null;
    cross_sell_promotions_current?: number | null;
    cross_sell_promotions_limit?: number | null;
    active_coupons_current?: number | null;
    active_coupons_limit?: number | null;
    installations_current?: number | null;
    installations_limit?: number | null;
  };
};

export type BillingCheckoutSessionResponse = {
  url: string;
};

export type BillingPortalSessionResponse = {
  url: string;
};

export type PaymentConnection = {
  id: string;
  provider: "stripe" | "asaas" | string;
  status: "active" | "pending" | "error" | string;
  account_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentOnboardingLinkResponse = {
  url: string;
};

export type AuditEvent = {
  id: string;
  actor_type: "human" | "service";
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  correlation_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  outcome: "success" | "failed";
  metadata: Record<string, unknown> | null;
  occurred_at: string;
};

export type AgentRules = Record<string, unknown> & {
  enabled?: boolean;
};

export interface NegotiationDiscountRange {
  minOfferDiscountPercent: number;
  maxDiscountPercent: number;
}

export interface CategoryNegotiationPolicy extends NegotiationDiscountRange {
  categoryId: string;
}

export interface ItemNegotiationPolicy extends NegotiationDiscountRange {
  sku: string;
}

export interface NegotiationPolicy {
  enabled: boolean;
  global: NegotiationDiscountRange;
  categories?: CategoryNegotiationPolicy[];
  items?: ItemNegotiationPolicy[];
  maxRounds: number;
  maxAiCostCents?: number;
  estimatedCostPerAiCallCents: number;
}

export interface NegotiationPolicyResponse {
  has_custom_policy: boolean;
  policy: NegotiationPolicy;
}

export interface NegotiationSession {
  id: string;
  global_user_id?: string;
  cart_fingerprint: string;
  agreement: boolean;
  selected_discount_percent: number;
  denial_reason?: string;
  estimated_ai_cost_cents: number;
  created_at: string;
  applied_at?: string;
}

export interface NegotiationStats {
  total_sessions: number;
  total_ai_cost_cents: number;
  agreement_count: number;
  agreement_rate: number;
  avg_discount_percent: number;
  total_ledger_entries: number;
  period: string;
}

export type CommerceConnection = {
  provider: "native" | "woocommerce" | "magento" | string;
  store_url: string;
  status: "pending" | "healthy" | "degraded" | string;
  api_version: string | null;
  last_tested_at: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type ConnectCommercePayload = {
  provider: "native" | "woocommerce" | "magento";
  store_url?: string;
  consumer_key?: string;
  consumer_secret?: string;
  access_token?: string;
  store_code?: string;
};

export type CommerceConnectionTestResult = {
  connection: CommerceConnection;
  store_name: string;
  currency: string;
};

export type Installation = {
  id: string;
  name: string | null;
  platform: string | null;
  status: "active" | "inactive" | string;
  health: "healthy" | "degraded" | "unknown" | string | null;
  created_at: string;
  updated_at: string;
};

export type CursorPage<T> = {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
};

export type EmbedSessionResponse = {
  embed_session_token: string;
  expires_at_unix: number;
};
