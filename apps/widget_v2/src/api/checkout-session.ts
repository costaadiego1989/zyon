import { CheckoutApiError } from "./checkout-api-error";
import type { CheckoutEditSection } from "@zyon/shared-types";
import { ChatRecoveryRequired, PendingChatReference, chatReceipt, chatDisplayReference, parseChatState, type ChatState, type ChatDisplayReference } from "./chat-protocol";

/**
 * CheckoutSession — API client for /embed/* endpoints.
 * Zero hardcoded data. All state comes from server.
 */

export interface CheckoutSessionConfig {
  embedToken: string;
  merchantId: string;
  cartRef?: string;
  apiBaseUrl: string;
  embedApiBaseUrl?: string;
  globalUserId?: string;
  buyerAccessToken?: string;
}

export interface BrandConfig {
  name?: string;
  subtitle?: string;
  logoUrl?: string;
  accentColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontDisplay?: string;
  borderColor?: string;
  borderRadius?: number;
  surfaceColor?: string;
  surfaceElevatedColor?: string;
  mutedTextColor?: string;
  successColor?: string;
  warningColor?: string;
  mode?: string;
  density?: string;
  backgroundImageUrl?: string;
  favicon?: string;
  agentAvatarUrl?: string;
  agentName?: string;
  agentGreeting?: string;
  stripeEnabled?: boolean;
  cryptoPaymentsEnabled?: boolean;
  cryptoPayments?: CryptoPaymentsConfig;
  logo_url?: string;
  accent_color?: string;
  theme?: BrandTheme;
}

export interface CryptoPaymentsConfig {
  token?: string;
  chain?: string;
  walletAddress?: string;
}

export interface BrandTheme {
  name?: string;
  logoUrl?: string;
  accentColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontDisplay?: string;
  borderColor?: string;
  borderRadius?: number;
  surfaceColor?: string;
  surfaceElevatedColor?: string;
  mutedTextColor?: string;
  successColor?: string;
  warningColor?: string;
  mode?: string;
  density?: string;
  agentName?: string;
}

export interface AgentConfig {
  name?: string;
  greeting?: string;
  language?: string;
}

export interface BuyerConfig {
  name?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  cpf?: string;
  isReturning?: boolean;
  purchaseCount?: number;
  address?: {
    zip?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
}

export interface CartItem {
  sku: string;
  name: string;
  price: number;
  originalPrice?: number;
  price_cents?: number;
  quantity: number;
  imageUrl?: string;
  category?: string;
  variant?: string;
  variantLabel?: string;
}

export interface SuggestedProduct {
  suggestion_id?: string;
  sku: string;
  variant_id?: string;
  name: string;
  unit_price: number;
  image_url?: string;
  in_stock?: boolean;
  product_url?: string;
  category?: string;
  description?: string;
  option_groups?: unknown[];
  display_mode?: string;
}

export interface CommercialNudge {
  kind: "coupon" | "progressive_discount" | "advanced_rule";
  title: string;
  message: string;
  badge?: string;
  couponCode?: string;
  ruleId?: string;
  discountPercent?: number;
}

export interface Experience {
  shipping_mode?: "standard" | "marketplace";
  policies?: { privacyUrl?: string; termsUrl?: string; refundUrl?: string; shippingUrl?: string };
  items?: Array<{ sku: string; name: string; quantity: number; unit_price: number; original_unit_price?: number; image_url?: string; variant?: string; variant_label?: string }>;
  totals?: { subtotal: number; shipping?: number; discount: number; service_fee?: number; total_to_pay?: number; total: number };
  shipping?: {
    carrier?: string;
    carrierKey?: string;
    method?: string;
    customerPrice?: number;
    deliveryDays?: number;
  };
  brand?: BrandConfig;
  agent?: AgentConfig;
  buyer?: BuyerConfig;
  customer?: BuyerConfig;
  cart?: { items: CartItem[] };
  stage?: string;
  copy?: { quick_replies?: string[] };
  stripeEnabled?: boolean;
  paymentMethods?: {
    pix: boolean;
    boleto: boolean;
    card: boolean;
    providers?: {
      pix?: "asaas" | "mercadopago" | "stripe";
      boleto?: "asaas" | "mercadopago" | "stripe";
      card?: "asaas" | "mercadopago" | "stripe";
    };
  };
  cryptoPaymentsEnabled?: boolean;
  cryptoPayments?: CryptoPaymentsConfig;
  suggestedProducts?: SuggestedProduct[];
  commercial_nudge?: CommercialNudge;
  applied_benefits?: Array<{ kind: "discount" | "shipping"; label: string; amount: number }>;
  rules?: { showBranding?: boolean; [key: string]: unknown };
}

export interface StartResponse {
  conversation_id?: string;
  chat_protocol?: "durable_v2";
  session_id: string;
  experience?: Experience;
}

export interface CrossSellAcceptResponse {
  experience?: Experience;
  agent_turn?: { role: "agent" | "buyer"; text: string; occurredAt?: string };
}

export function cartFromExperience(experience: Experience | undefined): { items: CartItem[]; total: number; discount: number; serviceFee: number; totalToPay?: number; shipping?: { key: string; label: string; cost: number }; benefits?: Experience["applied_benefits"] } {
  if (!experience?.items || !experience.totals) throw new Error("checkout_cart_snapshot_missing");
  const shipping = checkoutShippingFromExperience(experience.shipping);
  return {
    items: experience.items.map(item => ({ sku: item.sku, name: item.name, quantity: item.quantity, price: item.unit_price, originalPrice: item.original_unit_price, imageUrl: item.image_url, variant: item.variant, variantLabel: item.variant_label })),
    total: experience.totals.subtotal,
    discount: experience.totals.discount,
    serviceFee: typeof experience.totals.service_fee === "number" && Number.isFinite(experience.totals.service_fee) && experience.totals.service_fee >= 0
      ? experience.totals.service_fee
      : 0,
    totalToPay: typeof experience.totals.total_to_pay === "number" && Number.isFinite(experience.totals.total_to_pay) && experience.totals.total_to_pay >= 0
      ? experience.totals.total_to_pay
      : undefined,
    shipping,
    benefits: experience.applied_benefits,
  };
}

export function checkoutShippingFromExperience(shipping: Experience["shipping"]): { key: string; label: string; cost: number } | undefined {
  if (!shipping) return undefined;
  const cost = shipping.customerPrice;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return undefined;

  const carrier = shipping.carrier?.trim();
  const method = shipping.method?.trim();
  const label = carrier && method && carrier !== method
    ? `${carrier} · ${method}`
    : method || carrier || "Entrega selecionada";

  return {
    key: shipping.carrierKey?.trim() || carrier || method || "selected_shipping",
    label,
    cost,
  };
}

export interface ChatBlock {
  type: string;
  data?: Record<string, unknown>;
  text?: string;
}

export interface ChatResponse {
  display_ref?: ChatDisplayReference;
  chat_request?: { message_id: string; status: "completed" };
  blocks?: ChatBlock[];
  quick_replies?: string[];
  message?: string;
  experience?: Partial<Experience>;
  stage?: string;
  missing_fields?: string[];
  expected_input_type?: string;
}

export interface PaymentIntent {
  checkout_status?: string;
  order_id?: string;
  experience?: Experience;
  intent_id: string;
  method: string;
  status: string;
  pix_code?: string;
  pix_qr_url?: string;
  stripe_client_secret?: string;
  stripe_publishable_key?: string;
  stripe_account_id?: string;
  invoice_url?: string;
  crypto_chain?: string;
  crypto_chain_label?: string;
  crypto_network?: string;
  crypto_token_symbol?: string;
  crypto_amount_display?: string;
  crypto_amount_atomic?: string;
  crypto_destination_address?: string;
  crypto_token_address?: string;
  crypto_chain_id?: number;
  crypto_rpc_url?: string;
  crypto_block_explorer_url?: string;
  crypto_native_currency?: { name: string; symbol: string; decimals: number };
  crypto_transfers?: Array<{
    kind?: "merchant" | "platform_fee";
    destination_address: string;
    amount_atomic: string;
    amount_display: string;
  }>;
  expires_at_unix?: number;
  amount_cents?: number;
}

export class CheckoutSession {
  private paymentRecoveryPending = false;
  private token: string;
  private merchantId: string;
  private baseUrl: string;
  private embedBaseUrl: string;
  private globalUserId: string | undefined;
  private buyerAccessToken: string | undefined;
  private sessionId: string | null = null;
  private experience?: Experience;
  private paymentRevision = 0;
  private renewedPixIntent?: string;
  private conversationId: string | null = null;
  private protectedChat = false;
  private pendingMessageId?: string;
  private chatInFlight = false;
  private pendingReference?: PendingChatReference;
  chatState?: ChatState;
  private readonly displayedTurns = new Set<string>();
  private readonly displayInFlight = new Map<string, Promise<void>>();

  get hasMarketplacePaymentAttempt(): boolean { return this.experience?.shipping_mode === "marketplace" && !!this.chatState?.payment_intent_id; }

  get requiresChatRecovery(): boolean { return !!this.pendingMessageId || this.paymentRecoveryPending; }
  get usesDurableChat(): boolean { return this.protectedChat; }

  constructor(config: CheckoutSessionConfig) {
    this.token = config.embedToken;
    this.merchantId = config.merchantId;
    this.baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    this.embedBaseUrl = (config.embedApiBaseUrl ?? config.apiBaseUrl).replace(/\/$/, "");
    this.globalUserId = config.globalUserId;
    this.buyerAccessToken = config.buyerAccessToken;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get apiBaseUrl(): string {
    return this.baseUrl;
  }

  get embedApiBaseUrl(): string {
    return this.embedBaseUrl;
  }

  get authToken(): string {
    return this.token;
  }

  get currentMerchantId(): string {
    return this.merchantId;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async start(): Promise<StartResponse> {
    const res = await fetch(`${this.embedBaseUrl}/embed/start`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        merchant_id: this.merchantId,
        cart: { items: [] },
        customer_hints: this.globalUserId ? { externalCustomerId: this.globalUserId } : {},
        global_user_id: this.globalUserId || undefined,
        buyer_access_token: this.buyerAccessToken || undefined,
      }),
    });
    if (!res.ok) throw await CheckoutApiError.fromResponse("embed_start", res);
    const data = (await res.json()) as StartResponse;
    this.sessionId = data.session_id;
    this.conversationId = data.conversation_id ?? data.session_id;
    this.protectedChat = data.chat_protocol === "durable_v2";
    this.pendingReference = new PendingChatReference(`zyon:chat:v2:${JSON.stringify([this.embedBaseUrl, this.merchantId, this.sessionId, this.conversationId])}`);
    this.pendingMessageId = this.pendingReference.read();
    this.experience = data.experience;
    if (this.protectedChat || this.pendingMessageId) {
      this.protectedChat = true;
      await this.refreshChatState();
    }
    return data;
  }

  async fetchCart(): Promise<{ items: CartItem[]; total: number; discount: number; serviceFee: number; totalToPay?: number }> {
    return cartFromExperience(this.experience);
  }

  async chat(message: string, voiceTurnToken?: string): Promise<ChatResponse> {
    this.assertSession();
    if (this.requiresChatRecovery || this.chatInFlight) throw new ChatRecoveryRequired();
    const messageId = crypto.randomUUID();
    this.chatInFlight = true;
    if (this.protectedChat) this.setPending(messageId);
    try {
      const res = await fetch(`${this.embedBaseUrl}/embed/chat`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          session_id: this.sessionId,
          user_message: message,
          voice_turn_token: voiceTurnToken,
          conversation_id: this.conversationId,
          message_id: messageId,
        }),
      });
      if (!res.ok) {
        const error = await CheckoutApiError.fromResponse("embed_chat", res);
        if ((error.status === 429 && error.code === "ai_interaction_rate_limited") ||
          (error.status === 503 && error.code === "ai_rate_limit_unavailable")) {
          this.setPending(undefined);
          throw error;
        }
        if (error.chatRequest) {
          this.protectedChat = true;
          this.setPending(error.chatRequest.message_id);
        }
        // A quota/rate rejection is reported without a receipt on its first
        // response. Query the durable state instead of assuming no work ran.
        if (this.protectedChat) throw new ChatRecoveryRequired();
        throw error;
      }
      const response = await res.json() as ChatResponse;
      const receipt = chatReceipt(response.chat_request);
      if (this.protectedChat || receipt) {
        this.protectedChat = true;
        if (receipt?.message_id !== messageId || receipt.status !== "completed") throw new ChatRecoveryRequired();
        this.setPending(undefined);
      }
      if (response.experience) this.experience = { ...this.experience, ...response.experience };
      if (this.protectedChat && response.stage === "payment_pending") {
        const state = await this.refreshChatState();
        if (state.payment_intent_id) throw new ChatRecoveryRequired();
      }
      return response;
    } catch (error) {
      if (error instanceof CheckoutApiError &&
        ["ai_interaction_rate_limited", "ai_rate_limit_unavailable"].includes(error.code ?? "")) throw error;
      if (this.protectedChat) { if (!this.pendingMessageId) this.setPending(messageId); throw new ChatRecoveryRequired(); }
      throw error;
    } finally { this.chatInFlight = false; }
  }

  async reopenCheckout(section: CheckoutEditSection): Promise<Experience> {
    this.assertSession();
    if (this.pendingMessageId || this.chatInFlight) throw new ChatRecoveryRequired();
    if (!this.buyerAccessToken) throw new Error("payment_cancellation_auth_required");
    const response = await fetch(`${this.embedBaseUrl}/embed/checkout/edit`, { method: "POST", headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, section, buyer_access_token: this.buyerAccessToken }) });
    if (!response.ok) throw await CheckoutApiError.fromResponse("embed_checkout_edit", response);
    const result = await response.json() as { experience: Experience; revision?: number };
    this.experience = result.experience;
    this.paymentRevision = Math.max(this.paymentRevision + 1, result.revision ?? 0);
    this.paymentRecoveryPending = false;
    if (this.chatState) this.chatState = { ...this.chatState, payment_intent_id: undefined };
    return this.experience;
  }

  private setPending(messageId: string | undefined) {
    this.pendingMessageId = messageId;
    this.pendingReference?.write(messageId);
  }

  /** Visibility telemetry only. Never creates a chat/payment or blocks checkout.
   * The component verifies visibility; this verifies the exact rendered text. */
  async reportChatDisplay(reference: ChatDisplayReference, text: string): Promise<void> {
    this.assertSession();
    const ref = chatDisplayReference(reference);
    if (!ref || !text || text.length > 20_000 || !globalThis.crypto?.subtle) return;
    if (this.displayedTurns.has(ref.turn_id)) return;
    const inFlight = this.displayInFlight.get(ref.turn_id);
    if (inFlight) return inFlight;
    const task = (async () => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
      if (hash !== ref.text_hash) return;
      const res = await fetch(`${this.embedBaseUrl}/embed/chat/display`, { method: "POST", headers: this.headers(),
        signal: AbortSignal.timeout(10_000), body: JSON.stringify({ session_id: this.sessionId,
          conversation_id: this.conversationId, display_ref: ref, definition: "widget-visible-text-v1" }) });
      if (!res.ok) throw await CheckoutApiError.fromResponse("embed_chat_display", res);
      const receipt = await res.json() as { status?: string };
      if (receipt.status !== "recorded") throw new Error("checkout_chat_display_invalid_receipt");
      this.displayedTurns.add(ref.turn_id);
    })();
    this.displayInFlight.set(ref.turn_id, task);
    try { await task; } finally { this.displayInFlight.delete(ref.turn_id); }
  }

  async refreshChatState(): Promise<ChatState> {
    this.assertSession();
    const query = new URLSearchParams({ session_id: this.sessionId! });
    if (this.pendingMessageId) query.set("message_id", this.pendingMessageId);
    const res = await fetch(`${this.embedBaseUrl}/embed/chat/state?${query}`, { headers: this.headers(), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw await CheckoutApiError.fromResponse("embed_chat_state", res);
    const state = parseChatState(await res.json(), this.sessionId!, this.conversationId!);
    if (this.protectedChat && state.protocol !== "durable_v2") throw new ChatRecoveryRequired();
    this.protectedChat = state.protocol === "durable_v2";
    if (state.active_request) this.setPending(state.active_request.message_id);
    else if (this.pendingMessageId && state.request?.message_id === this.pendingMessageId
      && ["completed", "reconciled", "rejected"].includes(state.request.status)) this.setPending(undefined);
    this.chatState = state;
    this.paymentRecoveryPending = !!state.payment_intent_id;
    return state;
  }

  async recoverChat(): Promise<ChatState> {
    if (this.chatInFlight) throw new ChatRecoveryRequired();
    this.chatInFlight = true;
    try {
      await this.refreshChatState();
      if (this.pendingMessageId) {
        const res = await fetch(`${this.embedBaseUrl}/embed/chat/reconcile`, { method: "POST", headers: this.headers(), signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ session_id: this.sessionId, conversation_id: this.conversationId, message_id: this.pendingMessageId }) });
        if (!res.ok) throw await CheckoutApiError.fromResponse("embed_chat_reconcile", res);
        const receipt = chatReceipt((await res.json() as { chat_request?: unknown }).chat_request);
        if (receipt?.message_id !== this.pendingMessageId || !["completed", "reconciled", "rejected"].includes(receipt.status)) throw new ChatRecoveryRequired();
        // A receipt never substitutes for refreshing the server conversation.
        await this.refreshChatState();
      }
      if (this.pendingMessageId) throw new ChatRecoveryRequired();
      return this.chatState!;
    } finally { this.chatInFlight = false; }
  }

  async createRealtimeVoiceSession(input: { sdp: string }): Promise<{ sdp: string }> {
    this.assertSession();
    if (this.requiresChatRecovery) throw new ChatRecoveryRequired();
    const res = await fetch(`${this.embedBaseUrl}/embed/realtime/session`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, sdp: input.sdp }),
    });
    if (!res.ok) throw await CheckoutApiError.fromResponse("embed_realtime_voice", res);
    const data = await res.json() as { sdp?: unknown };
    if (typeof data.sdp !== "string") throw new Error("invalid_realtime_voice_session");
    return { sdp: data.sdp };
  }

  supportHeaders(): Record<string, string> {
    return { "x-aacp-embed-token": this.token, ...(this.buyerAccessToken ? { "X-Buyer-Authorization": `Bearer ${this.buyerAccessToken}` } : {}) };
  }

  async realtimeVoiceContext(): Promise<{ instructions: string }> {
    this.assertSession();
    if (this.requiresChatRecovery) throw new ChatRecoveryRequired();
    const res = await fetch(`${this.embedBaseUrl}/embed/realtime/context`, {
      method: "POST", headers: this.headers(), body: JSON.stringify({ session_id: this.sessionId }),
    });
    if (!res.ok) throw await CheckoutApiError.fromResponse("embed_realtime_context", res);
    const data = await res.json() as { instructions?: unknown };
    if (typeof data.instructions !== "string" || !data.instructions.trim()) throw new Error("invalid_realtime_context");
    return { instructions: data.instructions };
  }

  async updateCartItemQty(sku: string, quantity: number, variant?: string): Promise<StartResponse> {
    return this.updateCart([{ sku, quantity, variant }]);
  }

  async updateCart(items: Array<{ sku: string; quantity: number; variant?: string }>): Promise<StartResponse> {
    this.assertSession();
    const res = await fetch(`${this.embedBaseUrl}/embed/cart`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, items }),
    });
    if (!res.ok) throw await CheckoutApiError.fromResponse("embed_cart", res);
    const response = await res.json() as StartResponse;
    cartFromExperience(response.experience);
    this.experience = response.experience;
    this.paymentRevision += 1;
    return response;
  }

  async acceptCrossSell(suggestionId: string, sku: string): Promise<CrossSellAcceptResponse> {
    this.assertSession();
    const res = await fetch(`${this.embedBaseUrl}/embed/cross-sell/accept`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, suggestion_id: suggestionId, accepted_skus: [sku] }),
    });
    if (!res.ok) throw await CheckoutApiError.fromResponse("cross_sell_accept", res);
    const response = await res.json() as CrossSellAcceptResponse;
    if (response.experience) {
      cartFromExperience(response.experience);
      this.experience = response.experience;
      this.paymentRevision += 1;
    }
    return response;
  }

  async searchAvailableAlternatives(query: string): Promise<SuggestedProduct[]> {
    this.assertSession();
    const response = await fetch(`${this.embedBaseUrl}/embed/catalog/search?q=${encodeURIComponent(query)}&limit=8`, {
      headers: this.headers(), cache: "no-store",
    });
    if (!response.ok) throw await CheckoutApiError.fromResponse("embed_catalog", response);
    const body = await response.json();
    return Array.isArray(body.products) ? body.products.filter((product: SuggestedProduct) =>
      product.in_stock === true && typeof product.sku === "string" && typeof product.name === "string" &&
      typeof product.unit_price === "number" && Number.isFinite(product.unit_price) && product.unit_price >= 0) : [];
  }

  async addCatalogAlternative(sku: string, replaceSku?: string, replaceVariant?: string): Promise<CrossSellAcceptResponse> {
    this.assertSession();
    if (this.experience?.shipping_mode === "marketplace" || this.hasMarketplacePaymentAttempt || this.requiresChatRecovery || this.chatInFlight || this.chatState?.payment_intent_id) throw Error("checkout_unavailable");
    const response = await fetch(`${this.embedBaseUrl}/embed/catalog/add`, {
      method: "POST", headers: this.headers(), body: JSON.stringify({ session_id: this.sessionId, sku, quantity: 1, replace_sku: replaceSku, replace_variant: replaceVariant }),
    });
    if (!response.ok) throw await CheckoutApiError.fromResponse("embed_catalog_add", response);
    const body = await response.json() as CrossSellAcceptResponse;
    cartFromExperience(body.experience);
    this.experience = body.experience;
    this.paymentRevision++;
    return body;
  }

  async prepareExpiredPixRenewal(intentId: string, isCurrent: () => boolean): Promise<void> {
    this.assertSession();
    if (this.experience?.shipping_mode === "marketplace" || this.hasMarketplacePaymentAttempt || this.requiresChatRecovery || this.chatInFlight ||
        this.chatState?.payment_intent_id && this.chatState.payment_intent_id !== intentId) throw Error("checkout_unavailable");
    const sessionId = this.sessionId;
    const observed = await this.getPaymentStatus(intentId);
    if (this.sessionId !== sessionId || !isCurrent() || !["expired", "cancelled", "failed"].includes(observed.status) ||
        observed.checkout_status !== undefined || this.chatState?.payment_intent_id && this.chatState.payment_intent_id !== intentId) throw Error("pix_not_expired");
    // Retire only the intent the server confirmed as terminal. A lost creation
    // response retries the same renewal key; buyer/cart revision stays intact.
    if (this.chatState) this.chatState = { ...this.chatState, payment_intent_id: undefined };
    this.paymentRecoveryPending = false;
    if (this.renewedPixIntent !== intentId) { this.paymentRevision++; this.renewedPixIntent = intentId; }
  }

  async fetchShippingQuote(destinationZip?: string): Promise<Array<{ key: string; label: string; tag: string; sub: string; cost: number }>> {
    this.assertSession();
    const body: Record<string, unknown> = { session_id: this.sessionId };
    if (destinationZip) body.destination_zip = destinationZip;
    const res = await fetch(`${this.embedBaseUrl}/embed/shipping/quote`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      options?: Array<{ carrier: string; method: string; deliveryDays?: number; customerPrice: number; carrierKey: string }>;
      results?: Array<{ carrier_key: string; label: string; price: number; eta_days: number; is_free?: boolean }>;
    };
    const rawOptions = data.options ?? [];
    const rawResults = data.results ?? [];
    if (rawOptions.length > 0) {
      return rawOptions.map((o) => ({
        key: o.carrierKey,
        label: `${o.carrier} ${o.method}`.trim(),
        tag: o.deliveryDays ? `${o.deliveryDays} dias` : "A confirmar",
        sub: o.carrier,
        cost: Math.round(o.customerPrice * 100),
      }));
    }
    return rawResults.map((r) => ({
      key: r.carrier_key,
      label: r.label,
      tag: r.eta_days ? `${r.eta_days} dia${r.eta_days > 1 ? "s" : ""}` : "A confirmar",
      sub: r.is_free ? "Grátis" : `R$ ${(r.price / 100).toFixed(2)}`,
      cost: r.price,
    }));
  }

  async selectShipping(key: string): Promise<{ ok: boolean; shipping: { carrier: string; method: string; carrierKey: string; customerPrice: number } }> {
    this.assertSession();
    console.log('[WIDGET-DBG] API selectShipping', { key, sessionId: this.sessionId });
    const res = await fetch(`${this.embedBaseUrl}/embed/shipping/select`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, carrier_key: key }),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      console.error('[WIDGET-DBG] API selectShipping failed', { status: res.status, body: errorBody });
      throw new Error(`embed_shipping_failed: ${res.status} ${errorBody}`);
    }
    const result = await res.json();
    console.log('[WIDGET-DBG] API selectShipping response', result);
    return result;
  }

  async readChatPayment(state: ChatState): Promise<PaymentIntent | undefined> {
    this.assertSession();
    if (state.session_id !== this.sessionId || state.conversation_id !== this.conversationId || state.active_request) {
      throw new ChatRecoveryRequired();
    }
    if (!state.payment_intent_id) return undefined;
    const query = new URLSearchParams({ session_id: this.sessionId!, intent_id: state.payment_intent_id });
    const res = await fetch(`${this.embedBaseUrl}/embed/chat/payment?${query}`, {
      headers: this.headers(), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw await CheckoutApiError.fromResponse("embed_chat_payment", res);
    const intent = await this.mapPaymentResponse(res);
    if (intent.intent_id !== state.payment_intent_id || intent.status === "pending") throw new ChatRecoveryRequired();
    if (intent.status === "requires_action" && (
      (intent.method === "pix" && !intent.pix_code) || (intent.method === "boleto" && !intent.invoice_url)
      || (intent.method === "credito" && !intent.invoice_url && (!intent.stripe_client_secret || !intent.stripe_publishable_key))
    )) throw new ChatRecoveryRequired();
    this.paymentRecoveryPending = false;
    return intent;
  }

  async createPaymentIntent(
    method: "pix" | "boleto" | "credito" | "debito" | "crypto",
    installments?: number,
    options?: { chain?: "polygon" | "base"; confirmedCartFingerprint?: string; isCurrent?: () => boolean }
  ): Promise<PaymentIntent> {
    this.assertSession();
    if (this.pendingMessageId || this.chatInFlight || this.chatState?.payment_intent_id) throw new ChatRecoveryRequired();
    const apiMethod = method === "credito" || method === "debito" ? "card" : method;
    if (options?.isCurrent && !options.isCurrent()) throw Error("checkout_changed");
    const idempotencyKey = `pay_${this.sessionId}_${apiMethod}_${this.paymentRevision}`;
    console.log('[WIDGET-DBG] API createPaymentIntent', { method: apiMethod, sessionId: this.sessionId });
    const res = await fetch(`${this.embedBaseUrl}/embed/payment/intents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        session_id: this.sessionId,
        idempotency_key: idempotencyKey,
        method: apiMethod,
        installments,
        ...(options?.chain ? { preferred_chain: options.chain } : {}),
        ...(options?.confirmedCartFingerprint ? { confirmed_cart_fingerprint: options.confirmedCartFingerprint } : {}),
      }),
    });
    if (!res.ok) {
      const error = await CheckoutApiError.fromResponse("embed_payment", res);
      if (error.checkoutReview) {
        const review = error.checkoutReview;
        this.experience = { ...this.experience, commercial_nudge: undefined,
          items: review.cart.items.map(item => ({ sku: item.sku, name: item.name, quantity: item.quantity, unit_price: item.price, variant: item.variant })),
          shipping: review.shipping, totals: { subtotal: review.cart.total, discount: review.cart.currentDiscount ?? 0,
            shipping: review.shipping?.customerPrice ?? 0, service_fee: review.service_fee_cents / 100,
            total: review.order_total_cents / 100, total_to_pay: review.total_to_pay_cents / 100 } };
      }
      throw error;
    }
    return this.mapPaymentResponse(res, method);
  }

  private async mapPaymentResponse(res: Response, method?: PaymentIntent["method"]): Promise<PaymentIntent> {
    const raw = (await res.json()) as {
      id: string;
      status: string;
      method: string;
      amountCents: number;
      checkout_status?: string;
      order_id?: string;
      experience?: Experience;
      buyerFacing?: {
        qrCodeCopyPaste?: string;
        encodedQrImage?: string;
        invoiceUrl?: string;
        clientSecret?: string;
        stripePublishableKey?: string;
        stripeAccountId?: string;
        quoteExpiresAt?: string;
        chain?: "polygon" | "base";
        chainLabel?: string;
        evmNetwork?: "mainnet" | "testnet";
        tokenSymbol?: "USDC";
        amountDisplay?: string;
        amountAtomic?: string;
        destinationAddress?: string;
        tokenAddress?: string;
        transfers?: Array<{
          kind?: "merchant" | "platform_fee";
          destinationAddress?: string;
          amountAtomic?: string;
          amountDisplay?: string;
        }>;
        chainId?: number;
        rpcUrl?: string;
        blockExplorerUrl?: string;
        nativeCurrency?: { name: string; symbol: string; decimals: number };
      };
    };
    if (!raw || typeof raw.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(raw.id)
      || !["pix", "card", "boleto", "crypto"].includes(raw.method)
      || !Number.isSafeInteger(raw.amountCents) || raw.amountCents <= 0
      || !["pending", "requires_action", "approved", "failed", "cancelled", "refunded", "chargeback_pending",
        "chargeback_disputed", "chargeback_lost", "chargeback_won"].includes(raw.status)) throw new Error("payment_response_invalid");
    if (method === "pix" && !raw.buyerFacing?.qrCodeCopyPaste?.trim()) {
      throw new Error("pix_payload_unavailable");
    }
    const expiresAtUnix = raw.buyerFacing?.quoteExpiresAt
      ? Math.floor(Date.parse(raw.buyerFacing.quoteExpiresAt) / 1000)
      : undefined;
    const pixQrUrl = raw.buyerFacing?.encodedQrImage
      ? `data:image/png;base64,${raw.buyerFacing.encodedQrImage}`
      : undefined;
    if (raw.experience) {
      cartFromExperience(raw.experience);
      this.experience = { ...this.experience, ...raw.experience };
    }
    return {
      experience: raw.experience,
      intent_id: raw.id,
      method: method ?? (raw.method === "card" ? "credito" : raw.method as PaymentIntent["method"]),
      status: raw.status,
      pix_code: raw.buyerFacing?.qrCodeCopyPaste,
      pix_qr_url: pixQrUrl,
      stripe_client_secret: raw.buyerFacing?.clientSecret,
      stripe_publishable_key: raw.buyerFacing?.stripePublishableKey,
      stripe_account_id: raw.buyerFacing?.stripeAccountId,
      invoice_url: raw.buyerFacing?.invoiceUrl,
      crypto_chain: raw.buyerFacing?.chain,
      crypto_chain_label: raw.buyerFacing?.chainLabel,
      crypto_network: raw.buyerFacing?.evmNetwork,
      crypto_token_symbol: raw.buyerFacing?.tokenSymbol,
      crypto_amount_display: raw.buyerFacing?.amountDisplay,
      crypto_amount_atomic: raw.buyerFacing?.amountAtomic,
      crypto_destination_address: raw.buyerFacing?.destinationAddress,
      crypto_token_address: raw.buyerFacing?.tokenAddress,
      crypto_chain_id: raw.buyerFacing?.chainId,
      crypto_rpc_url: raw.buyerFacing?.rpcUrl,
      crypto_block_explorer_url: raw.buyerFacing?.blockExplorerUrl,
      crypto_native_currency: raw.buyerFacing?.nativeCurrency,
      // Keep every quote entry, including malformed ones, so the payment UI
      // can block before a partial transfer is sent instead of dropping it.
      crypto_transfers: raw.buyerFacing?.transfers?.map((transfer) => ({
        kind: transfer.kind === "merchant" || transfer.kind === "platform_fee" ? transfer.kind : undefined,
        destination_address: typeof transfer.destinationAddress === "string" ? transfer.destinationAddress : "",
        amount_atomic: typeof transfer.amountAtomic === "string" ? transfer.amountAtomic : "",
        amount_display: typeof transfer.amountDisplay === "string" ? transfer.amountDisplay : "",
      })),
      expires_at_unix: expiresAtUnix,
      amount_cents: raw.amountCents,
      checkout_status: raw.checkout_status,
      order_id: raw.order_id,
    };
  }

  async getPaymentStatus(intentId: string): Promise<{ status: string; paid_at?: string; checkout_status?: string; order_id?: string }> {
    this.assertSession();
    const res = await fetch(
      `${this.embedBaseUrl}/embed/payment/intents/${encodeURIComponent(intentId)}/status?session_id=${encodeURIComponent(this.sessionId!)}`,
      {
        method: "GET",
        headers: this.headers(),
      }
    );
    if (!res.ok) throw new Error(`embed_payment_status_failed: ${res.status}`);
    return res.json() as Promise<{ status: string; paid_at?: string; checkout_status?: string; order_id?: string }>;
  }

  async cancelPaymentIntent(intentId: string): Promise<import("../lib/payment-cancellation.js").PaymentCancellationResponse> {
    const scope = this as { isPaymentObservation?: boolean; hasMarketplacePaymentAttempt?: boolean };
    if (scope.isPaymentObservation || scope.hasMarketplacePaymentAttempt) throw new Error("payment_cancellation_unsupported");
    this.assertSession();
    if (!this.buyerAccessToken) throw new Error("payment_cancellation_auth_required");
    if (!/^[A-Za-z0-9_:-]{1,200}$/.test(intentId)) throw new Error("payment_cancellation_fields_invalid");
    const sessionId = this.sessionId;
    const response = await fetch(`${this.embedBaseUrl}/embed/payment/intents/${encodeURIComponent(intentId)}/cancel`, {
      method: "POST", headers: this.headers(), cache: "no-store", signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ session_id: sessionId, idempotency_key: `cancel_${intentId}`, buyer_access_token: this.buyerAccessToken }),
    });
    if (!response.ok) throw await CheckoutApiError.fromResponse("payment_cancellation", response);
    if (this.sessionId !== sessionId) throw new Error("checkout_changed");
    const { parsePaymentCancellation } = await import("../lib/payment-cancellation.js");
    const result = parsePaymentCancellation(await response.json(), intentId);
    if (result.cancellation === "cancelled") {
      // The authoritative receipt retires only this payment. Shopping totals and
      // merchant benefits remain untouched until a separate buyer edit command.
      if (this.chatState?.payment_intent_id && this.chatState.payment_intent_id !== intentId) throw new Error("checkout_changed");
      if (this.chatState) this.chatState = { ...this.chatState, payment_intent_id: undefined };
      this.paymentRecoveryPending = false;
      this.paymentRevision++;
    }
    return result;
  }

  async confirmStripePayment(intentId: string): Promise<{ status: string; intent_id: string }> {
    this.assertSession();
    const res = await fetch(`${this.embedBaseUrl}/embed/payment/intents/${encodeURIComponent(intentId)}/stripe/confirm`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        session_id: this.sessionId,
      }),
    });
    if (!res.ok) throw new Error(`stripe_confirm_failed: ${res.status}`);
    return res.json() as Promise<{ status: string; intent_id: string }>;
  }

  async applyOffer(offerId: string): Promise<unknown> {
    this.assertSession();
    const res = await fetch(`${this.embedBaseUrl}/embed/offers/apply`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, offer_id: offerId }),
    });
    if (!res.ok) throw new Error(`embed_offer_failed: ${res.status}`);
    return res.json();
  }

  async applyCoupon(code: string, cart: { items: Array<{ sku: string; name: string; price: number; quantity: number }>; total: number }): Promise<{
    discount_applied: number;
    shipping_discount_applied?: number;
    coupon: Record<string, unknown>;
    experience?: Experience;
  }> {
    this.assertSession();
    const res = await fetch(`${this.embedBaseUrl}/embed/coupons/apply`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, merchant_id: this.merchantId, code, cart }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail || `coupon_apply_failed: ${res.status}`);
    }
    const response = await res.json() as {
      discount_applied: number;
      shipping_discount_applied?: number;
      coupon: Record<string, unknown>;
      experience?: Experience;
    };
    if (response.experience) {
      cartFromExperience(response.experience);
      this.experience = response.experience;
      this.paymentRevision += 1;
    }
    return response;
  }

  async updateCustomer(data: Record<string, unknown>): Promise<unknown> {
    this.assertSession();
    const res = await fetch(`${this.embedBaseUrl}/embed/customer/update`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, ...data }),
    });
    if (!res.ok) throw new Error(`embed_customer_failed: ${res.status}`);
    return res.json();
  }

  private assertSession(): void {
    if (!this.sessionId) throw new Error("session_not_started");
  }
}

/**
 * Convert API cross-sell suggestions (experience.suggestedProducts) into a
 * `cross_sell` ChatBlock the widget's block renderer already understands.
 * Returns null when there is nothing to show.
 */
export function crossSellBlockFromSuggestions(
  suggestions: SuggestedProduct[] | undefined
): ChatBlock | null {
  if (!suggestions?.length) return null;
  const displayMode = suggestions[0]?.display_mode ?? "inline";
  return {
    type: "cross_sell",
    data: {
      displayMode,
      products: suggestions.map((p) => ({
        id: p.sku,
        suggestionId: p.suggestion_id,
        sku: p.sku,
        variantId: p.variant_id,
        name: p.name,
        price: p.unit_price,
        image: p.image_url,
        inStock: p.in_stock !== false,
      })),
    },
  };
}
