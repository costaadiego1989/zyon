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
  imageUrl?: string;
  productUrl?: string;
  category?: string;
  variant?: string;
}

export interface Cart {
  currency: CurrencyCode;
  total: number;
  items: CartItem[];
  currentDiscount?: number;
  source?: "storefront" | "checkout" | "platform_api" | "manual";
}

export interface CustomerHints {
  externalCustomerId?: string;
  /** Cliente cadastrado no Asaas (`cus_...`), vinculado ao pagador da sessão. */
  asaasCustomerId?: string;
  email?: string;
  phone?: string;
  isReturning?: boolean;
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
}

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
  abandonmentScore: number;
  triggerAgent: boolean;
  chatHistory: ChatTurn[];
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

export interface CheckoutBrandSnapshot {
  merchant_id: string;
  name: string;
  subtitle?: string;
  logo_url?: string;
  accent_color?: string;
  support_label?: string;
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
}

export interface CheckoutTotalsSnapshot {
  currency: CurrencyCode;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
}

export interface CheckoutExperienceSnapshot {
  brand: CheckoutBrandSnapshot;
  items: CheckoutItemSnapshot[];
  totals: CheckoutTotalsSnapshot;
  shipping?: ShippingQuote;
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
}

export interface TrackEventRequest {
  merchant_id: string;
  session_id: string;
  event: CheckoutEventName;
  metadata?: Record<string, unknown>;
}

export interface TrackEventResponse {
  received: true;
  abandonment_score: number;
  trigger_agent: boolean;
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

export interface CompletedOrder {
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  orderTotal: number;
  currency: CurrencyCode;
  acceptedOfferId?: string;
  completedAt: string;
}

export interface CompleteOrderRequest {
  merchant_id: string;
  session_id: string;
  external_order_id: string;
  order_total: number;
  currency: CurrencyCode;
  accepted_offer_id?: string;
}

export interface CompleteOrderResponse {
  recorded: true;
  idempotent: boolean;
  event_type: "order.completed";
}

export type CheckoutDomainEventType =
  | "checkout.session.started"
  | "checkout.event.tracked"
  | "checkout.abandonment.scored"
  | "checkout.abandoned"
  | "order.completed";

export interface DomainEventEnvelope<TPayload = Record<string, unknown>> {
  event_id: string;
  event_type: CheckoutDomainEventType;
  schema_version: 1;
  merchant_id: string;
  occurred_at: string;
  correlation_id: string;
  causation_id: string;
  producer: "checkout";
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

export interface CheckoutWidgetBehavior {
  openWidgetOnTrigger: boolean;
  startMinimized: boolean;
  position: CheckoutWidgetPosition;
  initialDelaySeconds: number;
}

export interface CheckoutInterventionPolicy {
  minimumAbandonmentScore: number;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSettingsPatch {
  mode?: CheckoutSettingsMode;
  widgetBehavior?: Partial<CheckoutWidgetBehavior>;
  interventionPolicy?: Partial<CheckoutInterventionPolicy>;
  triggerRules?: CheckoutTriggerRule[];
  suppressionRules?: Partial<CheckoutSuppressionRules>;
  handoff?: Partial<CheckoutHandoffSettings>;
}

export interface CheckoutSettingsContext {
  merchant_id: string;
  checkout_settings: {
    mode: CheckoutSettingsMode;
    open_widget_on_trigger: boolean;
    minimum_abandonment_score: number;
    cooldown_seconds: number;
    max_interventions_per_session: number;
    enabled_triggers: CheckoutTriggerName[];
    handoff_enabled: boolean;
  };
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
