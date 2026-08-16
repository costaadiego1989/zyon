export type CurrencyCode = "BRL" | "USD" | "EUR";

export type CheckoutEventName =
  | "checkout_started"
  | "cart_viewed"
  | "shipping_calculated"
  | "shipping_option_selected"
  | "shipping_objection_detected"
  | "coupon_field_clicked"
  | "payment_method_selected"
  | "payment_failed"
  | "exit_intent_detected"
  | "idle_30_seconds"
  | "offer_viewed"
  | "offer_accepted"
  | "order_completed"
  | "checkout_abandoned";

export interface CartItem {
  sku: string;
  name: string;
  price: number;
  cost?: number;
  quantity: number;
  weightGrams?: number;
  weight_kg?: number;
  height_cm?: number;
  width_cm?: number;
  length_cm?: number;
  imageUrl?: string;
  productUrl?: string;
  category?: string;
  variant?: string;
  description?: string;
  /** Alternative product identifier used by some commerce platforms */
  product_id?: string;
  /** Alternative product name used by some commerce platforms */
  title?: string;
  /** Alternative price field used by some commerce platforms */
  unit_price?: number;
}

export interface PackageDimensions {
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  quantity: number;
}

export interface ShippingContext {
  originZip: string;
  destinationZip: string;
  cartTotalCents: number;
  merchantId: string;
  packages: PackageDimensions[];
}

export interface Cart {
  currency: CurrencyCode;
  total: number;
  items: CartItem[];
  currentDiscount?: number;
  source?: "storefront" | "checkout" | "platform_api" | "manual";
  commerceCartRef?: string;
}

export interface CustomerAddress {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface CustomerHints {
  externalCustomerId?: string;
  asaasCustomerId?: string;
  email?: string;
  email_verified?: boolean;
  otp_code?: string;
  recognized_buyer?: boolean;
  phone?: string;
  phone_verified?: boolean;
  phone_otp_code?: string;
  address_verified?: boolean;
  isReturning?: boolean;
  fullName?: string;
  cpf?: string;
  address?: CustomerAddress;
}

export interface ShippingQuote {
  customerPrice: number;
  realCost?: number;
  carrier?: string;
  method?: string;
  deliveryDays?: number;
  destinationZip?: string;
  region?: string;
}

export interface ShippingQuoteRequest {
  session_id: string;
  destination_zip: string;
  cart_total: number;
  free_shipping_threshold?: number;
  packages?: PackageDimensions[];
}

export interface ShippingSelectRequest {
  session_id: string;
  carrier_key: string;
}

export interface ShippingQuoteResultDto {
  carrier_key: string;
  label: string;
  price: number;
  eta_days: number;
  is_free: boolean;
}

export interface ShippingQuoteResponse {
  id: string;
  session_id: string;
  merchant_id: string;
  destination_zip: string;
  results: ShippingQuoteResultDto[];
  selected_carrier_key: string | null;
  created_at: string;
  expires_at: string;
}

export interface StageQuickReplies {
  data_collection?: {
    nome?: string[];
    email?: string[];
    CPF?: string[];
    telefone?: string[];
    default?: string[];
  };
  shipping?: {
    CEP?: string[];
    confirmar?: string[];
    numero_complemento?: string[];
    frete?: string[];
    default?: string[];
  };
  payment?: string[];
  completed?: string[];
}

export interface MerchantCryptoPayments {
  enabled: boolean;
  chain: "polygon" | "base";
  network: "mainnet" | "testnet";
  treasuryAddress: string;
  token: "USDC";
  quoteTtlSeconds: number;
  brlPerUsdc?: number;
}

export interface MerchantPolicies {
  privacyUrl?: string;
  termsUrl?: string;
  refundUrl?: string;
  shippingUrl?: string;
}

export interface MerchantRules {
  maxDiscountPercent: number;
  minimumMarginPercent: number;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean;
  freeShippingMinCartValue: number;
  maxShippingSubsidy: number;
  maxPartialShippingDiscount: number;
  offerExpirationMinutes: number;
  blockedRegions: string[];
  brandVoice: "consultative" | "aggressive" | "premium" | "young" | "technical" | "popular";
  couponBoxEnabled: boolean;
  originZip?: string;
  quickReplies?: StageQuickReplies;
  cryptoPayments?: MerchantCryptoPayments;
  policies?: MerchantPolicies;
}

/**
 * Single canonical default for MerchantRules used across all paths.
 * All use-cases and the Prisma repository must reference this constant
 * instead of inlining their own defaults (P2 — prevents divergence).
 */
export const DEFAULT_MERCHANT_RULES: MerchantRules = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  allowShippingDiscount: true,
  allowBonusItem: false,
  allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: 250,
  maxShippingSubsidy: 45,
  maxPartialShippingDiscount: 20,
  offerExpirationMinutes: 15,
  blockedRegions: [],
  brandVoice: "consultative",
  couponBoxEnabled: true
};

export type ChatStage = "data_collection" | "shipping" | "payment" | "completed";

export type PaymentMethod = "pix" | "credit_card" | "crypto";

export type ChatTurnRole = "buyer" | "agent";

export interface ChatTurn {
  role: ChatTurnRole;
  text: string;
  occurredAt: string;
  authorizedOfferId?: string;
}

export interface CheckoutSession {
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  conversationId: string;
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  shippingOptions?: ShippingQuote[];
  abandonmentScore: number;
  triggerAgent: boolean;
  chatHistory: ChatTurn[];
  paymentMethod?: PaymentMethod;
  createdAt: string;
  updatedAt: string;
}

export interface StartCheckoutRequest {
  merchant_id: string;
  session_id?: string;
  customer?: CustomerHints;
  cart: Cart;
  shipping?: ShippingQuote;
}

export interface MerchantTheme {
  accentColor: string;
  secondaryColor?: string;
  textColor: string;
  backgroundColor: string;
  fontFamily: string;
  logoUrl?: string;
  agentAvatarUrl?: string;
  surfaceColor?: string;
  surfaceElevatedColor?: string;
  borderColor?: string;
  successColor?: string;
  warningColor?: string;
  mutedTextColor?: string;
  fontDisplay?: string;
  backgroundImageUrl?: string;
  borderRadius?: number;
  density?: "compact" | "comfortable" | "spacious";
  headerTitle?: string;
  headerSubtitle?: string;
  agentName?: string;
  trustBadges?: string[];
  mode?: "light" | "dark";
}

export const DEFAULT_MERCHANT_THEME: MerchantTheme = {
  accentColor: "#0F766E",
  secondaryColor: "#1E40AF",
  textColor: "#111827",
  backgroundColor: "#F7F8FA",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  surfaceColor: "#FFFFFF",
  surfaceElevatedColor: "#F8FAFC",
  borderColor: "#D9E2EC",
  successColor: "#047857",
  warningColor: "#B45309",
  mutedTextColor: "#64748B",
  fontDisplay: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  borderRadius: 8,
  density: "comfortable"
};

export interface CheckoutBrandSnapshot {
  merchant_id: string;
  name: string;
  subtitle?: string;
  logo_url?: string;
  accent_color?: string;
  support_label?: string;
  theme: MerchantTheme;
}

export interface CheckoutItemSnapshot {
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url?: string;
  product_url?: string;
  category?: string;
  variant?: string;
  description?: string;
}

export interface SuggestedProduct {
  suggestion_id?: string;
  sku: string;
  name: string;
  unit_price: number;
  image_url?: string;
  product_url?: string;
  category?: string;
  variant?: string;
  description?: string;
}

export interface CheckoutTotalsSnapshot {
  currency: CurrencyCode;
  subtotal: number;
  shipping: number;
  discount: number;
  service_fee?: number;
  total: number;
}

export interface CheckoutExperienceSnapshot {
  brand: CheckoutBrandSnapshot;
  stage?: ChatStage;
  rules?: {
    couponBoxEnabled: boolean;
    cryptoPaymentsEnabled?: boolean;
    cryptoPayments?: MerchantCryptoPayments;
    showBranding?: boolean;
  };
  policies?: MerchantPolicies;
  items: CheckoutItemSnapshot[];
  totals: CheckoutTotalsSnapshot;
  shipping?: ShippingQuote;
  shippingOptions?: ShippingQuote[];
  suggestedProducts?: SuggestedProduct[];
  customer?: CustomerHints;
  agent: {
    name: string;
    greeting: string;
    tone: AgentTone;
    language: string;
  };
  copy: {
    headline: string;
    subheadline: string;
    trust_badges: string[];
    quick_replies: string[];
    focus_input?: boolean;
    expected_input_type?: "text" | "email" | "tel" | "number";
  };
}

export interface StartCheckoutResponse {
  conversation_id: string;
  session_id: string;
  global_user_id: string;
  agent_enabled: boolean;
  initial_mode: "silent" | "open";
  tracking_token: string;
  experience: CheckoutExperienceSnapshot;
  turns?: ChatTurn[];
}

export interface TrackEventRequest {
  merchant_id: string;
  session_id: string;
  event: CheckoutEventName;
  metadata?: Record<string, unknown>;
}

export interface ProgressiveOfferResponse {
  stage: ProgressiveDiscountStage;
  requested_percent: number;
  approved_percent: number;
  reason: string;
}

export interface TrackEventResponse {
  received: true;
  abandonment_score: number;
  trigger_agent: boolean;
  progressive_offer?: ProgressiveOfferResponse;
}

export interface UpdateCartItemInput {
  sku: string;
  quantity: number;
}

export interface UpdateCartRequest {
  merchant_id: string;
  session_id: string;
  items: UpdateCartItemInput[];
}

export interface UpdateCartResponse {
  session_id: string;
  experience: CheckoutExperienceSnapshot;
}

export interface DecisionRequest {
  merchant_id: string;
  session_id: string;
  context?: Record<string, unknown>;
}

export interface DecisionResponse {
  decision_id: string;
  action: "trigger_agent" | "stay_silent";
  reason: string;
  abandonment_score: number;
}

export type OfferType =
  | "discount_percent"
  | "discount_fixed"
  | "shipping_free"
  | "shipping_discount_fixed"
  | "none";

export interface AuthorizedOffer {
  id: string;
  merchantId: string;
  sessionId: string;
  type: OfferType;
  value: number;
  approved: boolean;
  reason: string;
  marginAfterOffer: number;
  expiresAt: string;
  discountCode?: string;
}

export interface AcceptedOffer {
  merchantId: string;
  sessionId: string;
  offerId: string;
  type: OfferType;
  value: number;
  marginAfterOffer: number;
  acceptedAt: string;
  expiresAt: string;
}

export type CompletedOrderStatus =
  | "pending"
  | "approved"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

export interface CompletedOrder {
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  orderTotal: number;
  currency: CurrencyCode;
  status?: CompletedOrderStatus;
  acceptedOfferId?: string;
  trackingCode?: string;
  completedAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
}

export interface CompleteOrderRequest {
  merchant_id: string;
  session_id: string;
  external_order_id: string;
  order_total: number;
  currency: CurrencyCode;
  accepted_offer_id?: string;
  tracking_code?: string;
}

export interface CompleteOrderResponse {
  recorded: true;
  idempotent: boolean;
  event_type: "order.completed";
}

export interface UpdateOrderTrackingRequest {
  merchant_id: string;
  session_id: string;
  external_order_id: string;
  tracking_code: string;
}

export interface UpdateOrderTrackingResponse {
  updated: true;
  changed: boolean;
  event_type: "order.tracking.updated";
  order: CompletedOrder;
}

export type CheckoutDomainEventType =
  | "checkout.session.started"
  | "checkout.event.tracked"
  | "checkout.abandonment.scored"
  | "checkout.abandoned"
  | "checkout.cart.updated"
  | "order.completed"
  | "order.tracking.updated"
  | "whatsapp.message.requested"
  | "payment.status.changed"
  | "customer.phone_collected"
  | "customer.registered"
  | "funnel.step_completed";

export type CrossSellDomainEventType =
  | "cross-sell.offer.suggested"
  | "cross-sell.offer.accepted"
  | "cross-sell.offer.declined";

export type CouponsDomainEventType =
  | "coupon.applied"
  | "coupon.redeemed"
  | "coupon.expired";

export type SelfCheckoutDomainEventType =
  | "buyer.registered"
  | "buyer.wallet.payment-method-added"
  | "buyer.template.created"
  | "buyer.template.executed"
  | "buyer.consent.updated";

export type ScrapingAgentDomainEventType =
  | "scraping.job.requested"
  | "scraping.job.completed"
  | "scraping.job.failed"
  | "scraping.source.circuit-open";

export type ShippingDomainEventType =
  | "shipping.quote.created"
  | "shipping.method.selected";

export type FulfillmentDomainEventType =
  | "shipment.created"
  | "shipment.label-generated"
  | "shipment.status-updated"
  | "shipment.delivered"
  | "shipment.cancelled";

export type CommerceDomainEventType =
  | "commerce.order.pending"
  | "commerce.order.paid";

export type OnboardingDomainEventType =
  | "merchant.onboarding.step.completed"
  | "merchant.onboarding.completed";

export type DomainEventType =
  | CheckoutDomainEventType
  | CrossSellDomainEventType
  | CouponsDomainEventType
  | SelfCheckoutDomainEventType
  | ScrapingAgentDomainEventType
  | ShippingDomainEventType
  | FulfillmentDomainEventType
  | CommerceDomainEventType
  | OnboardingDomainEventType;

export type DomainEventProducer =
  | "checkout"
  | "cross-sell"
  | "coupons"
  | "self-checkout"
  | "scraping-agent"
  | "shipping"
  | "fulfillment"
  | "commerce"
  | "onboarding";

/**
 * Self-serve tenant onboarding (ADR 0015/0024). Resumable provisioning steps,
 * persisted server-side so the guided wizard can resume across sessions.
 */
export type OnboardingStepId = "account" | "checkout_config" | "embed" | "publish";

export type OnboardingStepStatus = "pending" | "completed";

export interface OnboardingStepState {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  completed_at?: string;
}

export interface OnboardingStateResponse {
  merchant_id: string;
  steps: OnboardingStepState[];
  completed: boolean;
  completed_at?: string;
  next_step?: OnboardingStepId;
}

export interface DomainEventEnvelope<TPayload = Record<string, unknown>> {
  event_id: string;
  event_type: DomainEventType;
  schema_version: 1;
  merchant_id: string;
  occurred_at: string;
  correlation_id: string;
  causation_id: string;
  producer: DomainEventProducer;
  payload: TPayload;
}

export interface ChatMessageRequest {
  merchant_id: string;
  session_id: string;
  conversation_id: string;
  user_message: string;
  agent_id?: string;
  agent_user_id?: string;
}

export type AgentRuleScope = "merchant_default" | "user_agent";
export type AgentTone = "consultative" | "premium" | "direct" | "friendly" | "technical";
export type AgentMode = "silent_until_trigger" | "proactive" | "manual_only";

export interface AgentIdentity {
  agentName: string;
  persona: string;
  tone: AgentTone;
  language: string;
  greeting: string;
}

export interface AgentCapabilities {
  priceObjectionHandling: boolean;
  shippingObjectionHandling: boolean;
  trustReassurance: boolean;
  paymentFrictionGuidance: boolean;
  escalation: boolean;
  machineToMachineNegotiation: boolean;
}

export interface AgentGuardrails {
  forbidUnauthorizedDiscounts: boolean;
  forbidUnauthorizedFreeShipping: boolean;
  forbidDeliveryPromisesWithoutSource: boolean;
  forbidStockPromisesWithoutSource: boolean;
  forbidPaymentStatusClaims: boolean;
  forbidLegalMedicalFinancialAdvice: boolean;
  forbidAbusivePressure: boolean;
  blockedPhrases: string[];
  requiredDisclaimers: string[];
  escalationTriggers: string[];
}

export interface AgentCheckoutSettings {
  agentMode: AgentMode;
  openWidgetOnTrigger: boolean;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  triggerPreferences: string[];
  handoffEnabled: boolean;
}

export type PurchaseHistoryDiscountSensitivity = "unknown" | "low" | "medium" | "high";

export interface AgentPurchaseHistoryContext {
  known_buyer: boolean;
  orders_count: number;
  lifetime_value: number;
  average_order_value: number;
  last_order_at?: string;
  top_categories: string[];
  recent_skus: string[];
  discount_sensitivity: PurchaseHistoryDiscountSensitivity;
  returning_customer_copy_hint: string;
}

export interface AgentContext {
  merchant_id: string;
  user_id?: string;
  agent_id: string;
  agent: AgentIdentity;
  capabilities: AgentCapabilities;
  guardrails: AgentGuardrails;
  checkout_settings: AgentCheckoutSettings;
  checkout_context?: CheckoutSettingsContext;
  purchase_history?: AgentPurchaseHistoryContext;
  copy_constraints: string[];
}

export type CheckoutSettingsMode = "silent_until_trigger" | "proactive" | "manual_only";
export type CheckoutWidgetPosition = "bottom_right" | "bottom_left";
export type CheckoutTriggerName =
  | "shipping_objection_detected"
  | "coupon_field_clicked"
  | "payment_failed"
  | "exit_intent_detected"
  | "idle_30_seconds";

export type ProgressiveDiscountStage =
  | "initial_coupon"
  | "exit_intent"
  | "abandoned_cart"
  | "payment_nudge";

export interface ProgressiveDiscountPolicy {
  enabled: boolean;
  stages: Record<ProgressiveDiscountStage, number>;
}

export interface ProgressiveDiscountPolicyPatch {
  enabled?: boolean;
  stages?: Partial<Record<ProgressiveDiscountStage, number>>;
}

export type CheckoutWidgetPresentationMode =
  | "fab"
  | "mini_card"
  | "bottom_banner"
  | "trigger_only"
  | "inline";

export type CheckoutFabClickAction = "redirect_to_cart" | "open_widget" | "open_new_tab";

export interface CheckoutWidgetBehavior {
  openWidgetOnTrigger: boolean;
  startMinimized: boolean;
  position: CheckoutWidgetPosition;
  initialDelaySeconds: number;
  presentationMode: CheckoutWidgetPresentationMode;
  fabColor?: string;
  inviteText?: string;
  showCartBadge?: boolean;
  fabClickAction?: CheckoutFabClickAction;
  fabRedirectUrl?: string;
}

export interface CheckoutInterventionPolicy {
  minimumAbandonmentScore: number;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  progressiveDiscount?: ProgressiveDiscountPolicy;
}

export interface CheckoutTriggerRule {
  trigger: CheckoutTriggerName;
  enabled: boolean;
  priority: number;
}

export interface CheckoutSuppressionRules {
  suppressedSteps: string[];
  blockedRegions: string[];
  minimumCartValue?: number;
  suppressAfterOfferAccepted: boolean;
  respectBuyerOptOut: boolean;
}

export interface CheckoutHandoffSettings {
  enabled: boolean;
  message: string;
  channels: Array<"email" | "whatsapp" | "chat">;
}

export interface CheckoutSettings {
  merchantId: string;
  mode: CheckoutSettingsMode;
  widgetBehavior: CheckoutWidgetBehavior;
  interventionPolicy: CheckoutInterventionPolicy;
  triggerRules: CheckoutTriggerRule[];
  suppressionRules: CheckoutSuppressionRules;
  handoff: CheckoutHandoffSettings;
  advancedRules: AdvancedRule[];
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSettingsPatch {
  mode?: CheckoutSettingsMode;
  widgetBehavior?: Partial<CheckoutWidgetBehavior>;
  interventionPolicy?: Partial<Omit<CheckoutInterventionPolicy, "progressiveDiscount">> & {
    progressiveDiscount?: ProgressiveDiscountPolicyPatch;
  };
  triggerRules?: CheckoutTriggerRule[];
  suppressionRules?: Partial<CheckoutSuppressionRules>;
  handoff?: Partial<CheckoutHandoffSettings>;
  advancedRules?: AdvancedRule[];
}

export interface CheckoutSettingsContext {
  merchant_id: string;
  checkout_settings: {
    mode: CheckoutSettingsMode;
    open_widget_on_trigger: boolean;
    position?: CheckoutWidgetPosition;
    fab_color?: string;
    invite_text?: string;
    presentation_mode?: string;
    start_minimized?: boolean;
    initial_delay_seconds?: number;
    show_cart_badge?: boolean;
    fab_click_action?: string;
    fab_redirect_url?: string;
    minimum_abandonment_score: number;
    cooldown_seconds: number;
    max_interventions_per_session: number;
    enabled_triggers: CheckoutTriggerName[];
    handoff_enabled: boolean;
    handoff_message?: string;
    handoff_channels?: string[];
    progressive_discount?: ProgressiveDiscountPolicy;
    suppressed_steps?: string[];
    blocked_regions?: string[];
  };
  merchant_rules: string[];
  operational_constraints: string[];
}

export interface ChatAction {
  label: string;
  type: "apply_offer" | "show_alternatives" | "continue_checkout";
  offer_id?: string;
}

export interface ChatMessageResponse {
  message: string;
  objection: "shipping_cost" | "price" | "trust" | "payment" | "unknown";
  authorized_offer?: AuthorizedOffer;
  actions: ChatAction[];
  turns: ChatTurn[];
  experience?: CheckoutExperienceSnapshot;
  stage?: ChatStage;
  missing_fields?: string[];
  expected_input_type?: string;
  ssml?: string;
  voice_config?: { speed: number; pitch: number };
}

export interface ShippingEvaluateRequest {
  merchant_id: string;
  session_id: string;
  cart_value?: number;
  shipping_price?: number;
  shipping_real_cost?: number;
  abandonment_score?: number;
}

export interface ShippingEvaluateResponse {
  approved: boolean;
  action: OfferType;
  reason: string;
  shipping_subsidy: number;
  margin_after_offer: number;
  message: string;
  offer?: AuthorizedOffer;
}

export interface ApplyOfferRequest {
  merchant_id: string;
  session_id: string;
  offer_id: string;
}

export interface ApplyOfferResponse {
  success: boolean;
  discount_code?: string;
  apply_url?: string;
  new_total?: number;
  expires_at?: string;
  reason?: string;
  experience?: CheckoutExperienceSnapshot;
  /** Turno do agente acrescentado quando a oferta foi aplicada com sucesso. */
  agent_turn?: ChatTurn;
}

export interface SupportFaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface SupportSettings {
  merchantId: string;
  faqItems: SupportFaqItem[];
  updatedAt: string;
}

export interface SupportSettingsPatch {
  faqItems: SupportFaqItem[];
}

export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface SupportTicket {
  id: string;
  merchantId: string;
  sessionId?: string;
  buyerMessage: string;
  status: SupportTicketStatus;
  source: "widget" | "dashboard" | "system";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface SupportTicketStatusPatch {
  status: SupportTicketStatus;
}

export interface DashboardOverview {
  merchant_id: string;
  conversations_started: number;
  offers_viewed: number;
  offers_accepted: number;
  orders_completed: number;
  conversion_rate_with_agent: number;
  average_discount: number;
  average_shipping_subsidy: number;
  incremental_revenue: number;
  recent_sessions: CheckoutSession[];
  recent_offers: AuthorizedOffer[];
}

export type StorePeriod = "today" | "7d" | "30d" | "90d";

export interface StoreOverviewTopProduct {
  product_id: string;
  name: string;
  image_url?: string;
  quantity: number;
  revenue: number;
}

export interface StoreOverviewRecentOrder {
  id: string;
  buyer_name: string;
  total: number;
  status: string;
  created_at: string;
}

export interface StoreOverview {
  merchant_id: string;
  period: string;
  revenue: number;
  orders_count: number;
  average_ticket: number;
  products_sold: number;
  new_customers: number;
  abandonment_rate: number;
  orders_by_status: Record<string, number>;
  top_products: StoreOverviewTopProduct[];
  recent_orders: StoreOverviewRecentOrder[];
}

export interface TimeseriesDataPoint {
  date: string;
  value: number;
}

export interface TimeseriesResponse {
  merchant_id: string;
  period: string;
  revenue_daily: TimeseriesDataPoint[];
  orders_daily: TimeseriesDataPoint[];
  sessions_daily: TimeseriesDataPoint[];
  conversion_daily: TimeseriesDataPoint[];
}

export interface ProductCategoryDTO {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  children?: ProductCategoryDTO[];
  product_count?: number;
}

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  parent_id?: string;
  description?: string;
  image_url?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  parent_id?: string | null;
  description?: string;
  image_url?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface ReorderCategoryItem {
  id: string;
  sort_order: number;
}

export interface StoreQuickReplyStage {
  stage: string;
  label: string;
  replies: string[];
}

export interface StoreQuickRepliesConfig {
  stages: StoreQuickReplyStage[];
  fallback: string[];
}

// ── Advanced Rules ──────────────────────────────────────────────────────────

export type ConditionField =
  | "cart_total"
  | "shipping_cost"
  | "product_in_cart"
  | "category_in_cart"
  | "coupon_applied"
  | "buyer_type"
  | "payment_method"
  | "trigger_fired"
  | "cart_item_count";

export type ConditionOperator = "gt" | "lt" | "gte" | "lte" | "eq" | "contains" | "is";

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string | number | boolean;
}

export type ActionType =
  | "offer_discount"
  | "offer_free_shipping"
  | "suggest_product"
  | "show_message"
  | "offer_installments"
  | "do_nothing"
  | "offer_coupon";

export interface RuleAction {
  type: ActionType;
  params: Record<string, string | number>;
}

export interface AdvancedRule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  action: RuleAction;
  enabled: boolean;
  priority: number;
}
