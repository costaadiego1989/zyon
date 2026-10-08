import { paymentCancellationCommand, paymentCancellationMessage } from "@/lib/payment-cancellation";
import { create } from "zustand";
import { checkoutEditIntent } from "@zyon/shared-types";
import type { ChatState } from "@/api/chat-protocol";
import {
  CheckoutSession,
  checkoutShippingFromExperience,
  crossSellBlockFromSuggestions,
  cartFromExperience,
  type BrandConfig,
  type AgentConfig,
  type CartItem,
  type ChatBlock,
  type PaymentIntent,
  type CryptoPaymentsConfig,
  type CommercialNudge,
  type Experience,
} from "@/api/checkout-session";
import {
  initTracking,
  trackEvent,
} from "@/lib/tracking";
import { resetTriggers, type TriggerConfig, type TriggerName } from "@/lib/triggers";
import { DEFAULT_ASSISTANCE, assistanceCommand, isStockError,
  type AssistanceSettings, type HelpAction, type HelpChoice } from "@/lib/checkout-assistance";
import type { AdvancedRule, RuleAction } from "@/lib/advanced-rules";
import { evaluateRules } from "@/lib/advanced-rules";
import type { DiscountStage } from "@/components/DiscountBanner";
import { connectPaymentWs } from "@/lib/payment-ws";
import { paymentPollingOutcome } from "@/lib/payment-status";
import {
  checkoutChatErrorMessage,
  checkoutPaymentErrorMessage,
  checkoutStartErrorMessage,
  isMerchantSalesSuspendedError,
  MERCHANT_SALES_SUSPENDED_MESSAGE,
} from "@/lib/checkout-error-message";
import { checkoutTotalWithServiceFee } from "@/lib/checkout-totals";
import { CheckoutApiError } from "@/api/checkout-api-error";
import type { CheckoutPriceReview } from "@/api/checkout-price-review";

export type CheckoutStatus = "loading" | "channel_gate" | "active" | "error" | "completed";
export type CartStatus = "awaiting" | "shipping_calculated" | "ready_to_pay" | "paid";

export interface ShippingOption {
  key: string;
  label: string;
  tag: string;
  sub: string;
  cost: number;
}

export function chooseQuickPurchaseShipping(
  options: ShippingOption[],
  preference: "fastest" | "cheapest",
): ShippingOption | undefined {
  const valid = options.filter((option) => option?.key && option?.label && Number.isFinite(option.cost) && option.cost >= 0);
  if (valid.length === 0) return undefined;
  const deliveryDays = (option: ShippingOption) => {
    const match = option.tag.match(/\d+/);
    return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
  };
  return [...valid].sort((left, right) => {
    if (preference === "cheapest") return left.cost - right.cost || deliveryDays(left) - deliveryDays(right);
    return deliveryDays(left) - deliveryDays(right) || left.cost - right.cost;
  })[0];
}

export interface PaymentMethod {
  key: string;
  label: string;
  sub: string;
}

export type CheckoutPaymentMethod = "pix" | "boleto" | "credito" | "debito" | "crypto";

export interface LeadRegistrationInput {
  name: string;
  email: string;
  phone: string;
  cpf: string;
}

interface PendingPayment {
  method: CheckoutPaymentMethod;
  installments?: number;
}
type PendingPriceReview = PendingPayment & { chain?: "polygon" | "base"; review: CheckoutPriceReview };

function activeDiscountFromNudge(nudge: CommercialNudge | undefined | null): CheckoutState["activeDiscount"] {
  if (!nudge) return null;
  return {
    stage: nudge.kind === "progressive_discount" ? "payment_nudge" : "initial_coupon",
    percent: nudge.discountPercent ?? 0,
    couponCode: nudge.couponCode,
    message: nudge.message,
  };
}

export interface MerchantPaymentConfig {
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
}

export function paymentMethodsForConfig(config: MerchantPaymentConfig): PaymentMethod[] {
  const methods: PaymentMethod[] = [];
  const available = config.paymentMethods;
  if (available?.pix) methods.push({ key: "pix", label: "Pix", sub: "Pagamento instantâneo" });
  if (available?.boleto) methods.push({ key: "boleto", label: "Boleto", sub: "Pague pelo link seguro" });
  // Older API responses may have only stripeEnabled; current responses carry
  // paymentMethods and are always preferred over a theme/client fallback.
  if (available?.card ?? config.stripeEnabled) {
    methods.push({ key: "credito", label: "Cartão de crédito", sub: "Pagamento seguro com cartão" });
    methods.push({ key: "debito", label: "Cartão de débito", sub: "Débito à vista" });
  }
  if (config.cryptoPaymentsEnabled) {
    const token = config.cryptoPayments?.token || "USDC";
    const chain = config.cryptoPayments?.chain || "polygon";
    methods.push({ key: "crypto", label: `Crypto · ${token}`, sub: `Liquida na ${chain} + cashback` });
  }
  return methods;
}

/** Turns an explicit payment chip into the UI payment action it represents. */
export function paymentMethodForQuickReply(text: string): CheckoutPaymentMethod | undefined {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (/^(pix|pagar com pix)$/.test(normalized)) return "pix";
  if (/^(boleto|pagar com boleto)$/.test(normalized)) return "boleto";
  if (/^(cartao de credito|credito|pagar com cartao)$/.test(normalized)) return "credito";
  if (/^(cartao de debito|debito)$/.test(normalized)) return "debito";
  if (/^(pagar com )?(crypto|cripto|usdc)$/.test(normalized)) return "crypto";
  return undefined;
}

/** Removes only payment choices that are not enabled for the current store. */
export function isEnabledPaymentQuickReply(text: string, config: MerchantPaymentConfig): boolean {
  const requested = paymentMethodForQuickReply(text);
  return !requested || paymentMethodsForConfig(config).some((method) => method.key === requested);
}

export interface BuyerData {
  name?: string;
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

function buyerFromExperience(experience: Partial<Experience> | undefined): BuyerData {
  const source = experience?.buyer ?? experience?.customer;
  const buyer: BuyerData = {};
  const name = source?.name ?? source?.fullName;
  if (name !== undefined) buyer.name = name;
  if (source?.email !== undefined) buyer.email = source.email;
  if (source?.phone !== undefined) buyer.phone = source.phone;
  if (source?.cpf !== undefined) buyer.cpf = source.cpf;
  if (source?.isReturning !== undefined) buyer.isReturning = source.isReturning;
  if (source?.purchaseCount !== undefined) buyer.purchaseCount = source.purchaseCount;
  if (source?.address !== undefined) buyer.address = source.address;
  return buyer;
}

function mergeBuyer(current: BuyerData, incoming: BuyerData): BuyerData {
  return {
    ...current,
    ...incoming,
    address: current.address || incoming.address
      ? { ...current.address, ...incoming.address }
      : undefined,
  };
}

function isAddressConfirmationCopy(message: string | undefined): boolean {
  return Boolean(message && /endere[cç]o[\s\S]{0,160}(?:est[aá]\s+correto|confirma|sim\s*\/\s*n[aã]o)/i.test(message));
}

function hasCompleteLead(buyer: BuyerData): boolean {
  return Boolean(
    buyer.name?.trim() &&
    buyer.email?.trim() &&
    buyer.phone?.replace(/\D/g, "").length &&
    buyer.cpf?.replace(/\D/g, "").length === 11,
  );
}

export interface CartState {
  items: CartItem[];
  total: number;
  /** Buyer service fee supplied by the signed checkout experience, in BRL. */
  serviceFee: number;
  /** Authoritative buyer charge from the checkout API before local cart changes. */
  totalToPay?: number;
  shipping?: { key: string; label: string; cost: number };
  discount: number;
  benefits?: Experience["applied_benefits"];
  status: CartStatus;
}

export interface Message {
  displayRef?: import("../api/chat-protocol").ChatDisplayReference;
  id: string;
  role: "agent" | "user";
  text?: string;
  blocks?: ChatBlock[];
  quickReplies?: string[];
  paymentRetry?: PendingPayment;
  /** Server-owned stage; legacy local fallbacks must not intercept its replies. */
  checkoutStage?: string;
  timestamp: number;
}

interface CheckoutState {
  assistance: AssistanceSettings;
  handoffEnabled: boolean;
  assistanceFailures: number;
  assistanceBusy: boolean;
  supportRequest: { id: string; message: string } | null;
  status: CheckoutStatus;
  error: string | null;

  sessionId: string | null;
  api: CheckoutSession | null;

  brand: BrandConfig;
  agent: AgentConfig;
  merchantPaymentConfig: MerchantPaymentConfig;

  buyer: BuyerData;

  cart: CartState;

  messages: Message[];
  isTyping: boolean;
  chatRecovery: "blocked" | "checking" | null;
  chatResponseUnavailable: boolean;
  recoverChat: () => Promise<void>;
  channel: "chat" | "voice";

  shippingMode: "standard" | "marketplace";
  paymentObservation: boolean;
  marketplacePaymentAttemptContext?: string | null;
  paymentIntent: PaymentIntent | null;
  pendingPriceReview: PendingPriceReview | null;
  paymentSubmitting: boolean;
  cancelPendingPayment: (method?: "pix") => Promise<void>;
  paymentCancellationPending: string | null;
  paymentPolling: boolean;
  paymentCreating: boolean;
  cartUpdating: boolean;
  cartError: string | null;

  triggerConfig: TriggerConfig | null;
  triggerMessages: Record<string, { message?: string; couponCode?: string }> | null;
  activeDiscount: { stage: DiscountStage; percent: number; couponCode?: string; message?: string } | null;
  progressiveDiscount: { enabled: boolean; stages: Record<string, number> } | null;
  advancedRules: AdvancedRule[];
  activeRuleActions: RuleAction[];
  /** Merchant hard cap on total discount percent. Coupon field hides once reached. */
  maxDiscountPercent: number;

  _pendingCrossSellBlock: ChatBlock | null;

  showBranding: boolean;
  policies: Experience["policies"];

  voiceEnabled: boolean;
  oneBuyClickPreferences: { shippingPreference: "fastest" | "cheapest"; paymentPreference: "pix" | "card" } | null;
  quickPurchaseStarted: boolean;
  quickPurchaseApplying: boolean;
  leadRegistered: boolean;
  pendingPayment: PendingPayment | null;

  init: (params: { embedToken: string; merchantId: string; cartRef?: string; apiBaseUrl: string; embedApiBaseUrl?: string; globalUserId?: string; buyerAccessToken?: string; oneBuyClickPreferences?: { shippingPreference: "fastest" | "cheapest"; paymentPreference: "pix" | "card" }; initialChannel?: "chat" | "voice" }) => Promise<void>;
  selectChannel: (channel: "chat" | "voice") => void;
  startQuickPurchase: () => Promise<void>;
  completeFormField: (field: string) => void;
  sendMessage: (text: string, voiceTurnToken?: string) => Promise<void>;
  /**
   * Continues the visual checkout after a Realtime `begin_checkout` tool call.
   * This can reveal the payment-method chooser, but cannot create an intent,
   * collect card data, or confirm a payment.
   */
  continueVoiceCheckout: () => Promise<void>;
  acceptCrossSell: (suggestionId: string, sku: string) => Promise<{ ok: boolean; error?: string }>;
  updateQty: (sku: string, quantity: number, variant?: string) => Promise<void>;
  removeCartItem: (sku: string, variant?: string) => Promise<void>;
  selectShipping: (option: Pick<ShippingOption, "key" | "label">) => Promise<boolean>;
  pay: (method: CheckoutPaymentMethod, installments?: number, confirmedCartFingerprint?: string, isCurrent?: () => boolean) => Promise<void>;
  confirmUpdatedOrder: (fingerprint: string) => Promise<void>;
  registerLead: (input: LeadRegistrationInput) => Promise<{ ok: boolean; error?: string }>;
  selectCryptoChain: (chain: "polygon" | "base", confirmedCartFingerprint?: string) => Promise<void>;
  pollPayment: () => void;
  reportPaymentFailure: (intentId: string) => Promise<void>;
  showCheckoutHelp: (kind: "pix" | "installments" | "stock" | "human", explicit?: boolean, sku?: string) => void;
  recordCheckoutDifficulty: (error?: unknown) => void;
  runHelpAction: (action: HelpAction, intentId?: string, cartContext?: string, sku?: string) => Promise<void>;
  addAlternative: (sku: string, cartContext: string, replaceSku?: string, replaceVariant?: string) => Promise<void>;
  stopPolling: () => void;
  setActiveDiscount: (stage: DiscountStage, percent: number, couponCode?: string, message?: string) => void;
  dismissDiscount: () => void;
  applyProgressiveDiscount: (cartStatus: CartStatus) => Promise<void>;
  applyCouponCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  /** Advance from the coupon step to the payment methods block. */
  proceedToPayment: (methods?: Array<{ key: string; label: string; sub?: string }>) => void;
  evaluateAdvancedRules: () => void;
  resetSession: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function priceReviewPatch(error: unknown, state: CheckoutState, payment: PendingPayment & { chain?: "polygon" | "base" }): Partial<CheckoutState> | undefined {
  if (!(error instanceof CheckoutApiError) || error.code !== "checkout_review_required") return undefined;
  const review = error.checkoutReview;
  const message: Message = { id: `price_review_${Date.now()}`, role: "agent", timestamp: Date.now(),
    text: review ? "O desconto deixou de estar disponível. Confira o novo total antes de continuar. Nenhum pagamento foi criado."
      : "As condições do pedido mudaram. Confira seu carrinho e o pagamento em andamento antes de continuar.",
    ...(review ? { blocks: [{ type: "checkout_price_review", data: { fingerprint: review.confirmation_fingerprint } }] } : {}) };
  return { pendingPriceReview: review ? { ...payment, review } : null,
    ...(review ? { paymentIntent: null, activeDiscount: null, cart: { ...state.cart, items: review.cart.items.map(item => ({ sku: item.sku, name: item.name,
      price: item.price, quantity: item.quantity, variant: item.variant })), total: review.cart.total,
      discount: review.cart.currentDiscount ?? 0, shipping: checkoutShippingFromExperience(review.shipping),
      serviceFee: review.service_fee_cents / 100, totalToPay: review.total_to_pay_cents / 100, status: "ready_to_pay" as const } } : {}),
    messages: [...state.messages, message] };
}

function recoveredMessages(state: ChatState, payment?: PaymentIntent): Message[] {
  const messages: Message[] = state.turns.map(turn => ({ id: `server_${turn.id}`, role: turn.role === "buyer" ? "user" : "agent",
    text: turn.text, timestamp: Date.parse(turn.occurred_at), displayRef: turn.display_ref,
    blocks: turn.blocks, checkoutStage: turn.checkout_stage }));
  if (payment) {
    const actionable = payment.status === "requires_action";
    const type = payment.method === "pix" ? "pix_payment" : payment.method === "boleto" ? "boleto_payment"
      : payment.method === "crypto" ? "crypto_payment" : payment.invoice_url ? "hosted_card_payment" : "stripe_card";
    const text = payment.status === "approved" ? "Pagamento confirmado."
      : payment.status === "failed" ? "O pagamento foi recusado."
      : payment.status === "cancelled" ? "Este pagamento foi cancelado."
      : payment.status === "refunded" ? "Este pagamento foi reembolsado."
      : actionable ? "Seu pagamento está disponível abaixo."
      : "Este pagamento está em contestação. Consulte a loja para acompanhar.";
    messages.push({ id: `payment_${payment.intent_id}`, role: "agent", text, timestamp: Date.now(),
      ...(actionable ? { blocks: [{ type, data: { ...payment } }] } : {}) });
  }
  return messages;
}
let wsCleanup: (() => void) | null = null;
const MAX_POLL_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Narration fallback for interactive blocks. When the backend/LLM returns a
 * component block with no accompanying text, the agent would otherwise "drop"
 * a silent UI element. This maps each block type to a short line so the agent
 * always speaks when it shows something. Returns null for blocks that are
 * self-explanatory or purely structural (no narration needed).
 */
function narrateBlock(block: ChatBlock): string | null {
  const count = (block.data?.products as unknown[] | undefined)?.length;
  switch (block.type) {
    case "cross_sell":
      return count === 1
        ? "Separei um item que combina com sua compra:"
        : "Separei alguns itens que combinam com sua compra:";
    case "shipping_options":
      return "Escolha como prefere receber:";
    case "payment_methods":
      return "Como você prefere pagar?";
    case "pix_payment":
      return "Gerei seu código Pix. Escaneie o QR Code ou copie o código abaixo:";
    case "boleto_payment":
      return "Gerei seu boleto. Abra o link seguro para pagar:";
    case "crypto_chain_select":
      return "Escolha a rede para pagar com cripto:";
    case "crypto_payment":
      return "Envie o valor para o endereço abaixo para concluir o pagamento:";
    case "stripe_card":
      return "Preencha os dados do seu cartão para finalizar:";
    case "address_confirmation":
      return "Confirme seu endereço de entrega:";
    case "form_field":
    case "lead_capture":
      return null;
    case "offer_coupon":
      return "Tenho um cupom pra você:";
    case "order_summary":
    case "cart_summary":
      return "Aqui está o resumo do seu pedido:";
    case "order_confirmation":
      return "Pedido confirmado! Obrigada pela compra. 🎉";
    default:
      return null;
  }
}

/**
 * Pick agent text for a message: prefer the LLM/backend text when present;
 * otherwise narrate the first block that has a narration. Guarantees no
 * interactive component renders without the agent saying anything.
 */
function resolveAgentText(message: string | undefined, blocks: ChatBlock[]): string | undefined {
  if (message && message.trim().length > 0) return message;
  for (const block of blocks) {
    const narration = narrateBlock(block);
    if (narration) return narration;
  }
  return message;
}

/**
 * Derive UI blocks from the server-reported checkout stage when the backend
 * response carries only text (no blocks). This bridges the gap for voice/
 * free-text flows where the deterministic string-match logic doesn't fire.
 */
function deriveBlocksFromStage(
  stage: string | undefined,
  state: { buyer: BuyerData; cart: CartState; merchantPaymentConfig: MerchantPaymentConfig },
  missingFields?: string[],
): ChatBlock[] | undefined {
  if (!stage) return undefined;

  // An explicit address correction overrides the complete address from the
  // previous order. Ask for the new CEP instead of confirming the old address.
  if (missingFields?.[0] === "CEP") {
    return [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }];
  }

  if (stage === "shipping" || stage === "delivery") {
    // Shipping includes CEP, confirmation, number, complement and freight.
    // Never derive another CEP field just because the address is incomplete.
    const next = missingFields?.[0];
    if (next === "número") {
      return [{ type: "form_field", data: { field: "address_number", label: "Número do endereço", placeholder: "Ex.: 100, apto 12" } }];
    }
    if (next?.includes("complemento")) {
      return [{ type: "form_field", data: { field: "address_complement", label: "Complemento", placeholder: "Ex.: apto 12 ou sem complemento" } }];
    }
    if (next === "frete" || next === "confirmar endereço") return [];
    if (state.cart.status === "shipping_calculated" || state.cart.status === "ready_to_pay") {
      return undefined;
    }
    const addr = state.buyer.address;
    const hasCompleteAddress = Boolean(addr?.zip && addr?.street && addr?.number && addr?.city && addr?.state);
    if (hasCompleteAddress && addr) {
      const addrLine = `${addr.street}, ${addr.number}${addr.complement ? ', ' + addr.complement : ''} - ${addr.city}/${addr.state}`;
      return [{ type: "address_confirmation", data: { address: addr, formatted: addrLine } }];
    }
    return [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }];
  }

  if (stage === "payment") {
    const methods = paymentMethodsForConfig(state.merchantPaymentConfig);
    return [{ type: "coupon_input", data: { methods } }];
  }

  return undefined;
}

function startPolling(): void {
  const state = useCheckoutStore.getState();
  const { api, paymentIntent } = state;
  if (!api || !paymentIntent || !paymentIntent.intent_id) return;
  if (pollTimer) return; // idempotent — a poll loop is already running

  const pollStartTime = Date.now();
  pollTimer = setInterval(async () => {
    if (Date.now() - pollStartTime > MAX_POLL_DURATION_MS) {
      useCheckoutStore.getState().stopPolling();
      useCheckoutStore.getState().resetSession();
      return;
    }
    try {
      const status = await api.getPaymentStatus(paymentIntent.intent_id);
      if (useCheckoutStore.getState().cartUpdating || useCheckoutStore.getState().paymentIntent?.intent_id !== paymentIntent.intent_id) return;
      const outcome = paymentPollingOutcome(status.status);
      if (outcome === "completed") {
        useCheckoutStore.getState().stopPolling();
        void trackEvent("order_completed", {
          intent_id: paymentIntent.intent_id,
        });
        useCheckoutStore.setState({
          cart: { ...useCheckoutStore.getState().cart, status: "paid" },
          status: "completed",
        });
      } else if (outcome === "failed") {
        useCheckoutStore.getState().stopPolling();
        applyTerminalPaymentStatus(status.status, paymentIntent.intent_id);
      }
    } catch {
    }
  }, 3000);
}

function applyMarketplaceStatus(observed: { status: string; checkout_status?: string; order_id?: string }, intentId: string): void {
  const state = useCheckoutStore.getState();
  if (state.paymentIntent?.intent_id !== intentId) return;
  useCheckoutStore.setState({ paymentIntent: { ...state.paymentIntent, status: observed.status,
    checkout_status: observed.checkout_status ?? "pending", order_id: observed.order_id } });
  if (observed.checkout_status === "completed" && observed.order_id) {
    state.stopPolling();
    useCheckoutStore.setState({ status: "completed", cart: { ...state.cart, status: "paid" } });
  } else if (paymentPollingOutcome(observed.status) === "failed") state.stopPolling();
}

export function marketplaceCardActionCurrent(state: CheckoutState, intentId: unknown, context: unknown): boolean {
  return state.shippingMode !== "marketplace" && !state.paymentObservation && state.paymentIntent?.intent_id === intentId && context === undefined;
}

function applyTerminalPaymentStatus(status: string, intentId: string): void {
  const state = useCheckoutStore.getState();
  if (!state.paymentIntent || state.paymentIntent.intent_id !== intentId || state.paymentObservation || state.status === "completed") return;
  useCheckoutStore.setState({ status: "active", error: null,
    paymentIntent: { ...state.paymentIntent, status },
    cart: { ...state.cart, status: "ready_to_pay" } });
  if (status === "failed") void state.reportPaymentFailure(intentId);
}

export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  assistance: { ...DEFAULT_ASSISTANCE }, handoffEnabled: true, assistanceFailures: 0, assistanceBusy: false, supportRequest: null,
  status: "loading",
  error: null,
  sessionId: null,
  api: null,
  brand: {},
  agent: {},
  merchantPaymentConfig: {},
  buyer: {},
  cart: { items: [], total: 0, serviceFee: 0, discount: 0, status: "awaiting" },
  messages: [],
  isTyping: false,
  chatRecovery: null,
  chatResponseUnavailable: false,
  channel: "chat",
  shippingMode: "standard", paymentObservation: false,
  paymentIntent: null,
  pendingPriceReview: null,
  paymentSubmitting: false,
  paymentCancellationPending: null,
  paymentPolling: false,
  paymentCreating: false,
  cartUpdating: false,
  cartError: null,
  triggerConfig: null,
  triggerMessages: null,
  activeDiscount: null,
  progressiveDiscount: null,
  advancedRules: [],
  activeRuleActions: [],
  maxDiscountPercent: 10,
  _pendingCrossSellBlock: null,
  showBranding: false,
  policies: {},
  voiceEnabled: false,
  oneBuyClickPreferences: null,
  quickPurchaseStarted: false,
  quickPurchaseApplying: false,
  leadRegistered: false,
  pendingPayment: null,

  init: async ({ embedToken, merchantId, cartRef, apiBaseUrl, embedApiBaseUrl, globalUserId, buyerAccessToken, oneBuyClickPreferences, initialChannel }) => {
    try {
      const api = new CheckoutSession({ embedToken, merchantId, cartRef, apiBaseUrl, embedApiBaseUrl, globalUserId, buyerAccessToken });
      get().stopPolling();
      resetTriggers();
      set({ assistance: { ...DEFAULT_ASSISTANCE }, handoffEnabled: true, assistanceFailures: 0, assistanceBusy: false, supportRequest: null, shippingMode: "standard", paymentObservation: false });
      set({ api, status: "loading", policies: {}, chatRecovery: null, chatResponseUnavailable: false, isTyping: false, messages: [], paymentIntent: null,
        pendingPriceReview: null, paymentCancellationPending: null, paymentSubmitting: false, paymentCreating: false, quickPurchaseStarted: false, quickPurchaseApplying: false });

      const response = await api.start();
      if (get().api !== api) return;
      const exp = response.experience;

      const cartData = cartFromExperience(exp);
      const items = cartData.items;
      const total = cartData.total || items.reduce((sum, i) => sum + i.price * i.quantity, 0);

      const buyer = buyerFromExperience(exp);

      const rawBrand = exp?.brand ?? {};
      const theme = rawBrand.theme ?? {};
      const brand: BrandConfig = {
        name: rawBrand.name ?? theme.name,
        subtitle: rawBrand.subtitle,
        logoUrl: rawBrand.logoUrl ?? theme.logoUrl ?? rawBrand.logo_url,
        accentColor: rawBrand.accentColor ?? theme.accentColor ?? rawBrand.accent_color,
        secondaryColor: theme.secondaryColor,
        backgroundColor: rawBrand.backgroundColor ?? theme.backgroundColor,
        textColor: rawBrand.textColor ?? theme.textColor,
        fontFamily: rawBrand.fontFamily ?? theme.fontFamily,
        fontDisplay: theme.fontDisplay,
        borderColor: theme.borderColor,
        borderRadius: rawBrand.borderRadius ?? theme.borderRadius,
        surfaceColor: theme.surfaceColor,
        surfaceElevatedColor: theme.surfaceElevatedColor,
        mutedTextColor: theme.mutedTextColor,
        successColor: theme.successColor,
        warningColor: theme.warningColor,
        mode: theme.mode,
        density: theme.density,
        backgroundImageUrl: rawBrand.backgroundImageUrl,
        favicon: rawBrand.favicon,
        agentAvatarUrl: rawBrand.agentAvatarUrl,
      };

      const agent: AgentConfig = {
        name: exp?.agent?.name ?? theme.agentName ?? rawBrand.agentName,
        greeting: exp?.agent?.greeting ?? rawBrand.agentGreeting,
        language: exp?.agent?.language,
      };

      set({
        sessionId: response.session_id,
        shippingMode: exp?.shipping_mode ?? "standard",
        chatRecovery: api.requiresChatRecovery ? "blocked" : null,
        chatResponseUnavailable: !api.requiresChatRecovery && api.chatState?.request?.response_outcome === "withheld",
        brand,
        agent,
        buyer,
        merchantPaymentConfig: {
          stripeEnabled: exp?.paymentMethods?.card ?? exp?.stripeEnabled ?? rawBrand.stripeEnabled ?? false,
          paymentMethods: exp?.paymentMethods,
          cryptoPaymentsEnabled: exp?.cryptoPaymentsEnabled ?? rawBrand.cryptoPaymentsEnabled ?? false,
          cryptoPayments: exp?.cryptoPayments ?? rawBrand.cryptoPayments,
        },
        cart: {
          items,
          total,
          serviceFee: cartData.serviceFee,
          totalToPay: cartData.totalToPay,
          shipping: cartData.shipping,
          discount: cartData.discount,
          status: cartData.shipping ? "shipping_calculated" : "awaiting",
        },
        activeDiscount: activeDiscountFromNudge(exp?.commercial_nudge),
        status: "channel_gate",
        error: null,
        _pendingCrossSellBlock: crossSellBlockFromSuggestions(exp?.suggestedProducts),
        showBranding: exp?.rules?.showBranding ?? false,
        policies: exp?.policies ?? {},
        voiceEnabled: (exp?.rules as { voiceEnabled?: boolean } | undefined)?.voiceEnabled ?? false,
        oneBuyClickPreferences: oneBuyClickPreferences ?? null,
        leadRegistered: hasCompleteLead(buyer),
        pendingPayment: null,
      });

      initTracking(api, response.session_id);
      void trackEvent("checkout_started");

      // OneBuyClick already knows the buyer's intent and preference. The chat
      // opens immediately and asks only for data still required by checkout.
      if (oneBuyClickPreferences || initialChannel) {
        const voiceAvailable = (exp?.rules as { voiceEnabled?: boolean } | undefined)?.voiceEnabled === true;
        get().selectChannel(initialChannel === "voice" && voiceAvailable ? "voice" : "chat");
      }
      if (oneBuyClickPreferences) void get().startQuickPurchase();

      try {
        const settingsRes = await fetch(
          `${apiBaseUrl}/checkout-settings/widget-config?merchantId=${encodeURIComponent(merchantId)}`
        );
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          set({
            triggerConfig: {
              mode: settings.mode,
              enabledTriggers: (settings.enabledTriggers ?? []) as TriggerName[],
              cooldownMs: (settings.cooldownSeconds ?? 120) * 1000,
              maxInterventions: settings.maxInterventionsPerSession ?? 3,
              idleSeconds: settings.idleSeconds ?? 180,
            },
            triggerMessages: settings.triggerMessages ?? null,
            assistance: { ...DEFAULT_ASSISTANCE, ...settings.assistance },
            handoffEnabled: settings.handoffEnabled !== false,
            progressiveDiscount: settings.progressiveDiscount ?? null,
            advancedRules: settings.advancedRules ?? [],
            maxDiscountPercent: settings.maxDiscountPercent ?? 10,
          });
        }
      } catch {
        /* silent — triggers are non-critical */
      }
    } catch (error) {
      set({ status: "error", error: checkoutStartErrorMessage(error) });
    }
  },

  selectChannel: (_channel) => {
    void trackEvent("channel_selected", { channel: _channel });

    const { cart, _pendingCrossSellBlock } = get();

    const welcomeText = cart.items.length > 0
      ? `Vi que você tem ${cart.items.length} ${cart.items.length === 1 ? 'item' : 'itens'} no carrinho. Vamos finalizar sua compra?`
      : `Olá, estou aqui para te ajudar a encontrar o produto ideal.`;

    const messages: Message[] = get().oneBuyClickPreferences
      ? []
      : [{
          id: "welcome",
          role: "agent",
          text: welcomeText,
          quickReplies: ["Vamos prosseguir", "Quero voltar"],
          timestamp: Date.now(),
        }];

    if (_pendingCrossSellBlock) {
      messages.push({
        id: "cross_sell_start",
        role: "agent",
        text: resolveAgentText(undefined, [_pendingCrossSellBlock]) ?? undefined,
        blocks: [_pendingCrossSellBlock],
        timestamp: Date.now() + 1,
      });
    }

    set({
      status: "active",
      channel: _channel,
      messages: get().api?.chatState?.turns.length ? recoveredMessages(get().api!.chatState!) : messages,
      _pendingCrossSellBlock: null,
    });
  },

  startQuickPurchase: async () => {
    const { api, cart, buyer, oneBuyClickPreferences, quickPurchaseStarted } = get();
    if (!api || !oneBuyClickPreferences || quickPurchaseStarted || get().cartUpdating || get().paymentCreating) return;
    set({ quickPurchaseStarted: true, quickPurchaseApplying: true });
    try {
      if (cart.items.length === 0) {
        set((state) => ({
          messages: [...state.messages, {
            id: `quick_purchase_empty_${Date.now()}`,
            role: "agent",
            text: "Seu carrinho está vazio. Escolha um produto para usar a compra rápida.",
            timestamp: Date.now(),
          }],
        }));
        return;
      }

      const hasCompleteAddress = Boolean(buyer.address?.zip && buyer.address.street && buyer.address.number && buyer.address.city && buyer.address.state);
      if (!hasCompleteAddress) {
        await get().sendMessage("Vamos prosseguir");
        return;
      }

      set((state) => ({
        messages: [...state.messages, {
          id: `quick_purchase_start_${Date.now()}`,
          role: "agent",
          text: `Aplicando sua preferência de frete ${oneBuyClickPreferences.shippingPreference === "cheapest" ? "mais econômico" : "mais rápido"} e pagamento por ${oneBuyClickPreferences.paymentPreference === "pix" ? "Pix" : "cartão"}.`,
          timestamp: Date.now(),
        }],
      }));

      if (!cart.shipping) {
        let option: ShippingOption | undefined;
        try {
          option = chooseQuickPurchaseShipping(
            await api.fetchShippingQuote(buyer.address?.zip),
            oneBuyClickPreferences.shippingPreference,
          );
        } catch {
          option = undefined;
        }
        const shippingSelected = option ? await get().selectShipping(option) : false;
        if (!shippingSelected) {
          await get().sendMessage("Vamos prosseguir");
          return;
        }
      }

      await get().pay(oneBuyClickPreferences.paymentPreference === "pix" ? "pix" : "credito");
    } finally {
      set({ quickPurchaseApplying: false });
    }
  },

  completeFormField: (field) => {
    set((state) => ({
      messages: state.messages.map((message) => ({
        ...message,
        blocks: message.blocks?.filter((block) => block.type !== "form_field" || block.data?.field !== field),
      })),
    }));
  },

  sendMessage: async (text, voiceTurnToken) => {
    const cancellationCommand = paymentCancellationCommand(text);
    if (cancellationCommand && !get().isTyping && !get().paymentSubmitting && !get().paymentCreating) {
      set(state => ({ messages: [...state.messages, { id: `user_${Date.now()}`, role: "user", text, timestamp: Date.now() }] }));
      await get().cancelPendingPayment(cancellationCommand === "pix" ? "pix" : undefined); return;
    }
    const editSection = checkoutEditIntent(text);
    if (get().status === "completed" || get().isTyping || get().chatRecovery || (get().api?.requiresChatRecovery && !editSection) || get().paymentSubmitting || get().paymentCreating) return;
    const lastPaymentMessage = [...get().messages].reverse().find(message => message.role === "agent");
    if (text.trim().toLowerCase() === "tentar novamente" && lastPaymentMessage?.paymentRetry) {
      const retry = lastPaymentMessage.paymentRetry;
      await get().pay(retry.method, retry.installments);
      return;
    }
    if (text === "Quero voltar") {
      window.history.back();
      return;
    }

    const { api } = get();
    if (!api || get().cartUpdating) return;

    const latest = [...get().messages].reverse().find(message => message.role === "agent");
    if (editSection && (get().paymentIntent || latest?.checkoutStage === "payment_pending"
      || (editSection !== "coupon" && (get().cart.shipping || latest?.checkoutStage === "payment")))) {
      set({ isTyping: true });
      try {
        const experience = await api.reopenCheckout(editSection);
        get().stopPolling();
        set(state => ({ paymentIntent: null, pendingPriceReview: null, pendingPayment: null, activeDiscount: null,
          cart: { ...cartFromExperience(experience), status: experience.shipping ? "shipping_calculated" : "awaiting" },
          messages: state.messages.map(message => ({ ...message, blocks: message.blocks?.filter(block =>
            !["pix_payment", "hosted_card_payment", "boleto_payment", "stripe_card", "crypto_payment", "checkout_price_review", "payment_methods", "shipping_options", "coupon_input"].includes(block.type)) })),
          isTyping: false }));
      } catch {
        set(state => ({ isTyping: false, messages: [...state.messages, { id: `edit_error_${Date.now()}`, role: "agent",
          text: "Ainda não foi possível liberar a alteração. Preciso confirmar que o pagamento anterior foi cancelado. Tente novamente em instantes.", timestamp: Date.now() }] }));
        return;
      }
    }
    const { messages } = get();

    const userMsg: Message = {
      id: `user_${Date.now()}`,
      role: "user",
      text,
      timestamp: Date.now(),
    };
    set({ messages: [...messages, userMsg], isTyping: true, chatResponseUnavailable: false });
    const helpCommand = assistanceCommand(text);
    if (helpCommand && get().assistance[helpCommand === "human" ? "humanHandoff" : helpCommand] &&
        (helpCommand !== "human" || get().handoffEnabled)) {
      set({ isTyping: false });
      if (helpCommand === "human") await get().runHelpAction("human");
      else get().showCheckoutHelp(helpCommand, true);
      return;
    }


    const normalizedConfirm = text.trim().toLowerCase().replace(/[.!?,;]+$/, "");
    const isAddrConfirm = ["sim", "correto", "confirmo", "certo", "isso", "é esse", "esse mesmo"].includes(normalizedConfirm);
    if (isAddrConfirm) {
      const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
      if (!lastAgentMsg?.checkoutStage && lastAgentMsg?.blocks?.some((b) => b.type === "address_confirmation")) {
        const { buyer } = get();
        const zip = buyer.address?.zip;
        if (!zip) {
          set((s) => ({
            messages: [...s.messages, {
              id: `agent_${Date.now()}`,
              role: "agent",
              text: "Para calcular o frete, preciso do seu CEP.",
              blocks: [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }],
              timestamp: Date.now(),
            }],
            isTyping: false,
          }));
          return;
        }
        let shippingOptions: Array<{ key: string; label: string; tag: string; sub: string; cost: number }> = [];
        try {
          shippingOptions = await api.fetchShippingQuote(zip);
        } catch (err) {
          console.error("[WIDGET] fetchShippingQuote failed", err);
        }
        const validOptions = shippingOptions.filter((o) => o && o.key && o.label);
        if (validOptions.length === 0) {
          set((s) => ({
            messages: [...s.messages, {
              id: `agent_${Date.now()}`, role: "agent",
              text: "Não consegui calcular o frete agora. Tente novamente.",
              quickReplies: ["Tentar novamente"], timestamp: Date.now(),
            }],
            isTyping: false,
          }));
          return;
        }
        set((s) => ({
          messages: [...s.messages, {
            id: `agent_${Date.now()}`, role: "agent",
            text: "Perfeito! Agora escolha como prefere receber:",
            blocks: [{ type: "shipping_options", data: { options: validOptions } }],
            timestamp: Date.now(),
          }],
          isTyping: false,
        }));
        return;
      }
    }

    const lastAgentMessage = [...messages].reverse().find((message) => message.role === "agent");
    if (text.startsWith("Entrega ·") && !lastAgentMessage?.checkoutStage) {
      const { merchantPaymentConfig } = get();
      const methods = paymentMethodsForConfig(merchantPaymentConfig);
      set((s) => ({
        messages: [...s.messages, {
          id: `agent_${Date.now()}`, role: "agent",
          text: "Frete selecionado! Tem um cupom de desconto?",
          blocks: [{ type: "coupon_input", data: { methods } }],
          timestamp: Date.now(),
        }],
        isTyping: false,
        cart: { ...s.cart, status: "shipping_calculated" },
      }));
      return;
    }

    try {
      const res = await api.chat(text, voiceTurnToken);
      if (get().api !== api) return;

      // Only use this offline fallback when the signed checkout service did
      // not report a stage. A real `payment` stage must reach the generic
      // handling below so voice can show the visual payment choices.
      if ((!res.blocks || res.blocks.length === 0) && !res.stage && text === "Vamos prosseguir") {
        const { buyer } = get();

        const addr = buyer.address;
        const hasCompleteAddress = Boolean(
          addr?.zip && addr?.street && addr?.number && addr?.city && addr?.state
        );

        if (!hasCompleteAddress || !addr) {
          const zipMsg: Message = {
            id: `agent_${Date.now()}`,
            role: "agent",
            text: "Para calcular o frete, preciso do seu CEP.",
            blocks: [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }],
            timestamp: Date.now(),
          };
          set((s) => ({ messages: [...s.messages, zipMsg], isTyping: false }));
          return;
        }

        const addrLine = `${addr.street}, ${addr.number}${addr.complement ? ', ' + addr.complement : ''} - ${addr.city}/${addr.state}`;
        const confirmMsg: Message = {
          id: `agent_${Date.now()}`,
          role: "agent",
          text: `Localizei seu endereço: ${addrLine}. Está correto?`,
          blocks: [{ type: "address_confirmation", data: { address: addr, formatted: addrLine } }],
          quickReplies: ["Sim", "Não"],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, confirmMsg], isTyping: false }));
        return;
      }

      if (!res.stage && text === "Não" && messages.length > 0) {
        const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
        if (lastAgentMsg?.blocks?.some((b) => b.type === "address_confirmation")) {
          const zipMsg: Message = {
            id: `agent_${Date.now()}`,
            role: "agent",
            text: "Sem problema. Informe o CEP de entrega:",
            blocks: [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }],
            timestamp: Date.now(),
          };
          set((s) => ({ messages: [...s.messages, zipMsg], isTyping: false }));
          return;
        }
      }

      const { buyer, cart, merchantPaymentConfig } = get();
      const updatedBuyer = mergeBuyer(buyer, buyerFromExperience(res.experience));
      const experienceShipping = checkoutShippingFromExperience(res.experience?.shipping);
      const baseBlocks = res.blocks && res.blocks.length > 0
        ? res.blocks
        : (isAddressConfirmationCopy(res.message)
          ? []
          : (deriveBlocksFromStage(res.stage, { buyer: updatedBuyer, cart, merchantPaymentConfig }, res.missing_fields) ?? []));
      const crossSellBlock = crossSellBlockFromSuggestions(res.experience?.suggestedProducts);
      const mergedBlocks = crossSellBlock
        ? [...baseBlocks, crossSellBlock]
        : baseBlocks;
      const agentText = resolveAgentText(res.message, mergedBlocks);
      const agentMsg: Message = {
        displayRef: agentText === res.message ? res.display_ref : undefined,
        id: `agent_${Date.now()}`,
        role: "agent",
        text: agentText,
        blocks: mergedBlocks,
        quickReplies: res.quick_replies ?? res.experience?.copy?.quick_replies,
        checkoutStage: res.stage,
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, agentMsg],
        buyer: updatedBuyer,
        leadRegistered: hasCompleteLead(updatedBuyer),
        isTyping: false,
        cart: res.experience?.items && res.experience.totals ? { ...s.cart, ...cartFromExperience(res.experience),
          shipping: experienceShipping, status: res.stage === "payment" ? "shipping_calculated" : res.stage === "shipping" ? "awaiting" : s.cart.status } : s.cart,
        ...(res.experience?.items && res.experience.totals ? { activeDiscount: activeDiscountFromNudge(res.experience.commercial_nudge) } : {}),
      }));

      // The signed checkout service is authoritative for its stage. Keep the
      // local state in sync so voice can reveal only the visual payment-method
      // chooser after delivery is already resolved. A payment intent remains
      // exclusively behind an explicit visual payment-method action.
      if (res.stage === "payment") {
        set((s) => ({
          cart: {
            ...s.cart,
            status: s.cart.status === "ready_to_pay" ? "ready_to_pay" : "shipping_calculated",
          },
        }));
      }

      const cartBlock = res.blocks?.find((b) => b.type === "cart_summary");
      if (cartBlock?.data) {
        const items = (cartBlock.data.items as CartItem[]) || [];
        const total = (cartBlock.data.total as number) || 0;
        set((s) => ({
          cart: { ...s.cart, items, total, totalToPay: undefined, discount: (cartBlock.data!.discount as number) || 0 },
        }));
      }

      const shippingConfirm = res.blocks?.find((b) => b.type === "shipping_confirmed");
      if (shippingConfirm?.data) {
        set((s) => ({
          cart: {
            ...s.cart,
            totalToPay: undefined,
            status: "shipping_calculated",
            shipping: shippingConfirm.data as { key: string; label: string; cost: number },
          },
        }));
      }

      const pixBlock = res.blocks?.find((b) => b.type === "pix_payment");
      if (pixBlock?.data) {
        set((s) => ({
          cart: { ...s.cart, status: "ready_to_pay" },
          paymentIntent: {
            intent_id: (pixBlock.data!.intent_id as string) || "",
            method: "pix",
            status: "pending",
            pix_code: pixBlock.data!.pix_code as string | undefined,
            pix_qr_url: pixBlock.data!.pix_qr_url as string | undefined,
          },
        }));
      }

      const orderBlock = res.blocks?.find((b) => b.type === "order_confirmation");
      if (orderBlock) {
        set({ status: "completed", cart: { ...get().cart, status: "paid" } });
      }
    } catch (err) {
      if (get().api !== api) return;
      if (!api.usesDurableChat) get().recordCheckoutDifficulty(err);
      const admissionError = checkoutChatErrorMessage(err);
      if (admissionError) {
        set(state => ({ messages: [...state.messages, { id: `error_${Date.now()}`, role: "agent", text: admissionError, timestamp: Date.now() }], isTyping: false }));
        if (voiceTurnToken) throw err;
        return;
      }
      if (voiceTurnToken) { set({ isTyping: false }); throw err; }
      if (api.usesDurableChat) {
        // Never run legacy shipping/payment fallbacks for an uncertain request.
        set({ isTyping: false, chatRecovery: "blocked" });
        return;
      }
      console.error("[WIDGET-CHAT] embed/chat failed:", err);
      if (isMerchantSalesSuspendedError(err)) {
        set({ status: "error", error: MERCHANT_SALES_SUSPENDED_MESSAGE, isTyping: false });
        return;
      }
      const chatError = checkoutChatErrorMessage(err);
      if (chatError) {
        set((state) => ({
          messages: [...state.messages, {
            id: `error_${Date.now()}`,
            role: "agent",
            text: chatError,
            timestamp: Date.now(),
          }],
          isTyping: false,
        }));
        return;
      }
      const { cart, buyer, merchantPaymentConfig } = get();
      if (text === "Vamos prosseguir" && cart.items.length > 0) {
        const address = buyer.address;
        const zip = address?.zip;
        const hasCompleteAddress = Boolean(
          address?.zip && address.street && address.number && address.city && address.state,
        );
        if (!hasCompleteAddress || !zip) {
          set((s) => ({
            messages: [...s.messages, {
              id: `agent_${Date.now()}`,
              role: "agent",
              text: "Para calcular o frete, preciso do seu CEP e endereço de entrega.",
              blocks: [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }],
              timestamp: Date.now(),
            }],
            isTyping: false,
          }));
          return;
        }
        try {
          const shippingOptions = await api.fetchShippingQuote(zip);
          if (shippingOptions.length > 0) {
            const shippingMsg: Message = {
              id: `agent_${Date.now()}`,
              role: "agent",
              text: "Escolha como prefere receber:",
              blocks: [{ type: "shipping_options", data: { options: shippingOptions } }],
              timestamp: Date.now(),
            };
            set((s) => ({ messages: [...s.messages, shippingMsg], isTyping: false }));
            return;
          }
        } catch { /* truly offline */ }
      }
      if (cart.status === "shipping_calculated" || cart.status === "ready_to_pay") {
        const payBlocks = deriveBlocksFromStage("payment", { buyer, cart, merchantPaymentConfig });
        if (payBlocks) {
          const payMsg: Message = {
            id: `agent_${Date.now()}`,
            role: "agent",
            text: "Escolha como prefere pagar:",
            blocks: payBlocks,
            timestamp: Date.now(),
          };
          set((s) => ({ messages: [...s.messages, payMsg], isTyping: false }));
          return;
        }
      }
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Não consegui conectar ao servidor. Tente novamente.",
        quickReplies: ["Tentar novamente"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg], isTyping: false }));
    }
  },

  recoverChat: async () => {
    const { api, chatRecovery, isTyping } = get();
    if (!api || chatRecovery === "checking" || isTyping) return;
    set({ chatRecovery: "checking" });
    try {
      const state = await api.recoverChat();
      const payment = await api.readChatPayment(state);
      if (get().api !== api) return;
      get().stopPolling();
      set({ messages: recoveredMessages(state, payment), paymentIntent: payment ?? null, chatRecovery: null, isTyping: false,
        chatResponseUnavailable: state.request?.response_outcome === "withheld",
        ...(payment ? { cart: { ...get().cart, totalToPay: payment.amount_cents! / 100,
          // Approval certifies payment. It does not certify fulfillment/order completion.
          status: payment.status === "approved" ? "paid" : "ready_to_pay" } } : {}) });
    } catch {
      if (get().api === api) set({ chatRecovery: "blocked", isTyping: false });
    }
  },

  continueVoiceCheckout: async () => {
    if (get().chatRecovery || get().api?.requiresChatRecovery) return;
    const before = get().cart.status;
    if (before === "ready_to_pay") return;
    if (before === "shipping_calculated") {
      get().proceedToPayment();
      return;
    }

    // This goes through the signed checkout conversation. It can ask for the
    // next delivery detail, but cannot reach payment until the backend has
    // reported the payment stage.
    await get().sendMessage("Vamos prosseguir");
    if (get().cart.status === "shipping_calculated") {
      get().proceedToPayment();
    }
  },

  acceptCrossSell: async (suggestionId, sku) => {
    const { api, cartUpdating, status } = get();
    if (!api || cartUpdating || get().paymentSubmitting || status === "completed") {
      return { ok: false, error: "checkout_unavailable" };
    }
    set({ cartUpdating: true, cartError: null, pendingPriceReview: null });
    try {
      const response = await api.acceptCrossSell(suggestionId, sku);
      const cart = cartFromExperience(response.experience);
      get().stopPolling();
      set((state) => ({
        cart: { ...cart, status: "awaiting" }, assistanceFailures: 0,
        activeDiscount: activeDiscountFromNudge(response.experience?.commercial_nudge),
        paymentIntent: null,
        messages: response.agent_turn?.text
          ? [...state.messages, {
              id: `cross_sell_${Date.now()}`,
              role: "agent" as const,
              text: response.agent_turn.text,
              timestamp: Date.now(),
            }]
          : state.messages,
      }));
      void trackEvent("cross_sell_accepted", { sku });
      return { ok: true };
    } catch (error) {
      if (get().api !== api) return { ok: false, error: "checkout_changed" };
      get().recordCheckoutDifficulty(error);
      const message = "Nao foi possivel adicionar este complemento. Tente novamente.";
      set({ cartError: message });
      return { ok: false, error: message };
    } finally {
      set({ cartUpdating: false });
    }
  },

  updateQty: async (sku, quantity, variant) => {
    const { api, cartUpdating, status } = get();
    if (!api || cartUpdating || get().paymentSubmitting || status === "completed") return;
    set({ cartUpdating: true, cartError: null, pendingPriceReview: null });
    try {
      const response = await api.updateCartItemQty(sku, quantity, variant);
      const cart = cartFromExperience(response.experience);
      get().stopPolling();
      set((state) => ({
        cart: { ...cart, status: "awaiting" }, assistanceFailures: 0,
        activeDiscount: activeDiscountFromNudge(response.experience?.commercial_nudge),
        paymentIntent: null,
        messages: [
          ...state.messages.map(message => ({ ...message, blocks: message.blocks?.filter(block => !["pix_payment", "boleto_payment", "stripe_card", "crypto_payment", "crypto_chain_select", "shipping_options", "payment_methods", "coupon_input"].includes(block.type)) })),
          { id: `cart_${Date.now()}`, role: "agent" as const, text: cart.items.length ? "Carrinho atualizado. Vamos confirmar o frete antes do pagamento." : "Produto removido. Seu carrinho está vazio.", timestamp: Date.now() },
        ],
      }));
      void trackEvent(quantity === 0 ? "item_removed" : "item_quantity_updated", { sku, new_qty: quantity });
    } catch (error) {
      get().recordCheckoutDifficulty(error);
      set({ cartError: "Não foi possível atualizar o carrinho. Seus itens foram mantidos; tente novamente." });
    } finally {
      set({ cartUpdating: false });
    }
  },

  removeCartItem: async (sku, variant) => {
    await get().updateQty(sku, 0, variant);
  },

  selectShipping: async (option) => {
    const { api } = get();
    if (!api || get().cartUpdating || get().paymentSubmitting) return false;
    set({ cartUpdating: true, cartError: null, pendingPriceReview: null });
    console.log('[WIDGET-DBG] selectShipping called', { key: option.key });
    try {
      const result = await api.selectShipping(option.key);
      const cost = result.shipping?.customerPrice;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        throw new Error("embed_shipping_invalid_price");
      }
      console.log('[WIDGET-DBG] selectShipping success', { key: option.key, result });
      set((s) => ({
        assistanceFailures: 0,
        cart: {
          ...s.cart,
          totalToPay: checkoutTotalWithServiceFee({
            subtotal: s.cart.total,
            shipping: cost,
            discount: s.cart.discount,
            serviceFee: s.cart.serviceFee,
          }),
          shipping: {
            key: option.key,
            label: option.label,
            // customerPrice is in reais (major units); cart.total and the
            // SmartCart formatter also work in reais, so keep the same unit.
            // Multiplying by 100 here inflated shipping and the total 100x.
            cost,
          },
          status: "shipping_calculated",
        },
      }));
      void trackEvent("shipping_option_selected", { key: option.key });
      return true;
    } catch (err) {
      console.error('[WIDGET-DBG] selectShipping failed', { key: option.key, error: err });
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Não foi possível confirmar o frete. Tente novamente.",
        quickReplies: ["Tentar novamente"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
      get().recordCheckoutDifficulty(err);
      return false;
    } finally {
      set({ cartUpdating: false });
    }
  },

  registerLead: async (input) => {
    const { api, pendingPayment } = get();
    if (!api) return { ok: false, error: "Sessão não iniciada" };

    const buyer: LeadRegistrationInput = {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.replace(/\D/g, ""),
      cpf: input.cpf.replace(/\D/g, ""),
    };
    if (!buyer.name || !buyer.email || buyer.phone.length < 10 || buyer.cpf.length !== 11) {
      return { ok: false, error: "Preencha nome, e-mail, telefone e CPF válidos." };
    }

    try {
      await api.updateCustomer({
        customer: {
          fullName: buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          cpf: buyer.cpf,
        },
      });
      if (get().api !== api) return { ok: false, error: "checkout_changed" };
      set((state) => ({
        buyer: { ...state.buyer, ...buyer },
        leadRegistered: true,
        assistanceFailures: 0,
        pendingPayment: null,
      }));

      if (pendingPayment) {
        // Saving identity requires a fresh, explicit payment confirmation.
        get().proceedToPayment();
      }
      return { ok: true };
    } catch (error) {
      if (get().api === api) get().recordCheckoutDifficulty(error);
      return { ok: false, error: "Não foi possível salvar seus dados agora. Tente novamente." };
    }
  },

  confirmUpdatedOrder: async (fingerprint) => {
    const pending = get().pendingPriceReview;
    if (!pending || get().paymentSubmitting || get().paymentCreating || pending.review.confirmation_fingerprint !== fingerprint) return;
    if (pending.chain) await get().selectCryptoChain(pending.chain, fingerprint);
    else await get().pay(pending.method, pending.installments, fingerprint);
  },

  cancelPendingPayment: async method => {
    const state = get(), { api, paymentIntent, sessionId } = state;
    if (state.paymentSubmitting || state.paymentCreating) return;
    const addMessage = (text: string) => set(current => ({ isTyping: false, messages: [...current.messages,
      { id: `cancel_${Date.now()}`, role: "agent", text, timestamp: Date.now() }] }));
    if (!api || !sessionId || !paymentIntent || method === "pix" && paymentIntent.method !== "pix") {
      addMessage("Não há um pagamento pendente correspondente para cancelar."); return;
    }
    const cancellationScope = state as { shippingMode?: string; paymentObservation?: boolean };
    if (cancellationScope.shippingMode === "marketplace" || cancellationScope.paymentObservation) {
      addMessage("O cancelamento deste pagamento não está disponível por aqui."); return;
    }
    if (state.status === "completed" || !["pending", "requires_action"].includes(paymentIntent.status)) {
      addMessage("Este pagamento já saiu do estado pendente e não foi cancelado."); return;
    }
    const current = () => get().api === api && get().sessionId === sessionId && get().paymentIntent?.intent_id === paymentIntent.intent_id;
    set({ isTyping: true, paymentCancellationPending: paymentIntent.intent_id });
    try {
      const result = await api.cancelPaymentIntent(paymentIntent.intent_id);
      if (!current()) return;
      // Local completion or a websocket approval always wins a late cancel reply.
      if (get().status === "completed" || get().cart.status === "paid") { set({ isTyping: false, paymentCancellationPending: null }); return; }
      if (result.cancellation === "cancelled") {
        get().stopPolling();
        set(currentState => ({ paymentIntent: null, paymentCancellationPending: null, pendingPayment: null,
          messages: currentState.messages.map(message => ({ ...message, blocks: message.blocks?.filter(block => block.data?.intent_id !== paymentIntent.intent_id) })) }));
      } else if (result.cancellation === "pending") {
        set(currentState => ({ paymentIntent: { ...paymentIntent, pix_code: undefined, pix_qr_url: undefined, invoice_url: undefined, stripe_client_secret: undefined },
          messages: currentState.messages.map(message => ({ ...message, blocks: message.blocks?.filter(block => block.data?.intent_id !== paymentIntent.intent_id) })) }));
      } else set({ paymentCancellationPending: null });
      addMessage(paymentCancellationMessage(result));
    } catch (error) {
      if (!current()) return;
      const code = error instanceof Error ? error.message : "";
      if (code === "payment_cancellation_auth_required") {
        set({ paymentCancellationPending: null }); addMessage("Entre na sua conta de comprador para cancelar este pagamento.");
      } else {
        // The request may have reached the provider; stop offering stale payment
        // credentials while recovery reads the same durable operation.
        set(currentState => ({ paymentIntent: { ...paymentIntent, pix_code: undefined, pix_qr_url: undefined, invoice_url: undefined, stripe_client_secret: undefined },
          messages: currentState.messages.map(message => ({ ...message, blocks: message.blocks?.filter(block => block.data?.intent_id !== paymentIntent.intent_id) })) }));
        addMessage("Não foi possível confirmar o cancelamento. Seu carrinho foi mantido; consulte a mesma operação antes de gerar outro pagamento.");
      }
    }
  },

  pay: async (method, installments, confirmedCartFingerprint, isCurrent) => {
    const { api, sessionId, cart, leadRegistered } = get();
    if (get().assistanceBusy && !isCurrent || isCurrent && !isCurrent()) return;
    if (!api || get().paymentCancellationPending || get().paymentSubmitting || get().paymentCreating || get().cartUpdating || get().chatRecovery || api.requiresChatRecovery) return;
    if (get().pendingPriceReview && confirmedCartFingerprint !== get().pendingPriceReview!.review.confirmation_fingerprint) return;
    if (api.chatState?.payment_intent_id) {
      const previous = get().paymentIntent;
      if (!previous || previous.intent_id !== api.chatState.payment_intent_id || paymentPollingOutcome(previous.status) !== "failed") return;
      const cartContext = JSON.stringify(cart);
      const current = () => get().api === api && get().sessionId === sessionId && get().status === "active" &&
        get().paymentIntent?.intent_id === previous.intent_id && JSON.stringify(get().cart) === cartContext && (!isCurrent || isCurrent());
      set({ paymentSubmitting: true });
      try { await api.prepareTerminalPaymentRetry(previous.intent_id, current); }
      catch {
        if (current()) set(state => ({ messages: [...state.messages, { id: `payment_retry_${Date.now()}`, role: "agent", timestamp: Date.now(),
          text: "Ainda não consegui confirmar que o pagamento anterior terminou. Consulte a operação antes de tentar outra forma de pagamento." }] }));
        return;
      } finally { if (get().api === api && get().sessionId === sessionId) set({ paymentSubmitting: false }); }
      if (!current()) return;
    }

    const availableMethods = paymentMethodsForConfig(get().merchantPaymentConfig);
    if (!availableMethods.some((available) => available.key === method)) {
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Essa forma de pagamento não está disponível para esta loja.",
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
      return;
    }

    const shippingChosen = Boolean(cart.shipping) ||
      cart.status === "shipping_calculated" || cart.status === "ready_to_pay";
    if (!shippingChosen) {
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Selecione um frete antes de pagar.",
        quickReplies: ["Voltar"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
      return;
    }

    if (!leadRegistered) {
      set((state) => ({
        pendingPayment: { method, installments },
        messages: [...state.messages, {
          id: `agent_lead_${Date.now()}`,
          role: "agent",
          text: "Antes de gerar o pagamento, preciso registrar seus dados para acompanhar seu pedido.",
          blocks: [{ type: "lead_capture" }],
          timestamp: Date.now(),
        }],
      }));
      return;
    }

    if (method === "crypto") {
      const chainSelectMsg: Message = {
        id: `agent_pay_${Date.now()}`,
        role: "agent",
        text: "Escolha a rede para pagar com USDC:",
        blocks: [{ type: "crypto_chain_select", data: { chains: ["polygon", "base"] } }],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, chainSelectMsg] }));
      return;
    }

    set({ paymentSubmitting: true, paymentCreating: true });
    try {
      const intent = await api.createPaymentIntent(method, installments, { confirmedCartFingerprint, isCurrent });
      if (get().api !== api || get().sessionId !== sessionId || isCurrent && !isCurrent()) return;
      if (method === "pix" && !intent.pix_code?.trim()) {
        throw new Error("pix_payload_unavailable");
      }
      void trackEvent("payment_method_selected", { method, intent_id: intent.intent_id });
      set({
        paymentIntent: intent,
        pendingPriceReview: null,
        cart: { ...get().cart, ...(intent.experience ? cartFromExperience(intent.experience) : {}), totalToPay: intent.amount_cents! / 100, status: "ready_to_pay" },
        ...(intent.experience ? { activeDiscount: activeDiscountFromNudge(intent.experience.commercial_nudge) } : {}),
      });

      const isCard = method === "credito" || method === "debito";
      if (isCard && (!intent.stripe_client_secret || !intent.stripe_publishable_key) && !intent.invoice_url) {
        throw new Error("card_checkout_unavailable");
      }
      if (method === "boleto" && !intent.invoice_url) {
        throw new Error("boleto_invoice_unavailable");
      }
      const blockType = method === "pix"
        ? "pix_payment"
        : method === "boleto"
          ? "boleto_payment"
          : intent.invoice_url
            ? "hosted_card_payment"
            : "stripe_card";
      const blockText = method === "pix"
        ? "Pix gerado! Pague e confirmo seu pedido automaticamente."
        : method === "boleto"
          ? "Boleto gerado! Abra o link seguro para pagar."
          : intent.invoice_url
            ? "Abra o ambiente seguro para informar o cartão e concluir o pagamento."
            : "Preencha os dados do cartão para finalizar.";
      const paymentMsg: Message = {
        id: `agent_pay_${Date.now()}`,
        role: "agent",
        text: blockText,
        blocks: [{
          type: blockType,
          data: {
            intent_id: intent.intent_id,
            pix_code: intent.pix_code,
            pix_qr_url: intent.pix_qr_url,
            invoice_url: intent.invoice_url,
            hosted_card: Boolean(isCard && intent.invoice_url),
            stripe_client_secret: intent.stripe_client_secret,
            stripe_publishable_key: intent.stripe_publishable_key,
            stripe_account_id: intent.stripe_account_id,
            expires_at_unix: intent.expires_at_unix,
            amount_cents: intent.amount_cents,
          },
        }],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, paymentMsg] }));
    } catch (error) {
      if (get().api !== api || get().sessionId !== sessionId || isCurrent && !isCurrent()) return;
      const review = priceReviewPatch(error, get(), { method, installments });
      if (review) { set(review); return; }
      if (isMerchantSalesSuspendedError(error)) {
        set({ status: "error", error: MERCHANT_SALES_SUSPENDED_MESSAGE });
        return;
      }
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: checkoutPaymentErrorMessage(error),
        quickReplies: ["Tentar novamente"],
        paymentRetry: { method, installments },
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
      if (get().api === api) get().recordCheckoutDifficulty(error);
    } finally {
      if (get().api === api && get().sessionId === sessionId) set({ paymentSubmitting: false, paymentCreating: false });
    }
  },

  selectCryptoChain: async (chain, confirmedCartFingerprint) => {
    const { api, leadRegistered } = get();
    if (!api || get().paymentCancellationPending || get().paymentSubmitting || get().paymentCreating || get().cartUpdating || get().chatRecovery || api.requiresChatRecovery || api.chatState?.payment_intent_id) return;
    if (get().pendingPriceReview && confirmedCartFingerprint !== get().pendingPriceReview!.review.confirmation_fingerprint) return;

    if (!leadRegistered) {
      await get().pay("crypto");
      return;
    }

    set({ paymentSubmitting: true, paymentCreating: true });
    try {
      const intent = await api.createPaymentIntent("crypto", undefined, { chain, confirmedCartFingerprint });
      if (get().api !== api) return;
      void trackEvent("payment_method_selected", { method: "crypto", intent_id: intent.intent_id, chain });
      set({
        paymentIntent: intent,
        pendingPriceReview: null,
        cart: { ...get().cart, ...(intent.experience ? cartFromExperience(intent.experience) : {}), totalToPay: intent.amount_cents! / 100, status: "ready_to_pay" },
        ...(intent.experience ? { activeDiscount: activeDiscountFromNudge(intent.experience.commercial_nudge) } : {}),
      });

      const paymentMsg: Message = {
        id: `agent_pay_${Date.now()}`,
        role: "agent",
        text: "Envie o valor em USDC para o endereço abaixo.",
        blocks: [{
          type: "crypto_payment",
          data: {
            intent_id: intent.intent_id,
            crypto_chain_label: intent.crypto_chain_label,
            crypto_network: intent.crypto_network,
            crypto_token_symbol: intent.crypto_token_symbol,
            crypto_amount_display: intent.crypto_amount_display,
            crypto_amount_atomic: intent.crypto_amount_atomic,
            crypto_destination_address: intent.crypto_destination_address,
            crypto_token_address: intent.crypto_token_address,
            crypto_chain_id: intent.crypto_chain_id,
            crypto_rpc_url: intent.crypto_rpc_url,
            crypto_block_explorer_url: intent.crypto_block_explorer_url,
            crypto_native_currency: intent.crypto_native_currency,
            crypto_transfers: intent.crypto_transfers,
            expires_at_unix: intent.expires_at_unix,
            amount_cents: intent.amount_cents,
          },
        }],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, paymentMsg] }));
    } catch (error) {
      if (get().api !== api) return;
      const review = priceReviewPatch(error, get(), { method: "crypto", chain });
      if (review) { set(review); return; }
      if (isMerchantSalesSuspendedError(error)) {
        set({ status: "error", error: MERCHANT_SALES_SUSPENDED_MESSAGE });
        return;
      }
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: checkoutPaymentErrorMessage(error),
        quickReplies: ["Tentar novamente"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
    } finally {
      if (get().api === api) set({ paymentSubmitting: false, paymentCreating: false });
    }
  },

  pollPayment: () => {
    const { api, paymentIntent } = get();
    if (!api || !paymentIntent || !paymentIntent.intent_id) return;
    set({ paymentPolling: true });

    // Defensive HTTP polling runs alongside the WS: if the WebSocket connects
    // but never delivers an event (silent channel, proxy buffering), the 3s
    // HTTP poll still detects approval. startPolling() is idempotent via
    // pollTimer, and whichever path wins calls stopPolling() to cancel both.
    startPolling();

    wsCleanup = connectPaymentWs({
      apiBaseUrl: api.apiBaseUrl,
      token: api.authToken,
      intentId: paymentIntent.intent_id,
      onApproved: async () => {
        if (get().api !== api || get().cartUpdating || get().paymentIntent?.intent_id !== paymentIntent.intent_id) return;
        try {
          // The WS may precede the first HTTP read, including on historical
          // checkouts whose client bootstrap omitted the marketplace marker.
          const observed = await api.getPaymentStatus(paymentIntent.intent_id);
          if (get().api !== api || get().cartUpdating || get().paymentIntent?.intent_id !== paymentIntent.intent_id) return;
          if (get().shippingMode === "marketplace" || Object.hasOwn(observed, "checkout_status") || get().paymentIntent?.checkout_status !== undefined) {
            applyMarketplaceStatus(observed, paymentIntent.intent_id);
            return;
          }
          const outcome = paymentPollingOutcome(observed.status);
          if (outcome === "completed") {
            get().stopPolling();
            void trackEvent("order_completed", { intent_id: paymentIntent.intent_id });
            set({ cart: { ...get().cart, status: "paid" }, status: "completed" });
          } else if (outcome === "failed") {
            get().stopPolling();
            applyTerminalPaymentStatus(observed.status, paymentIntent.intent_id);
          }
        } catch {
          // HTTP polling remains active. A transport failure is not approval.
        }
      },
      onFailed: async () => {
        if (get().api !== api || get().cartUpdating || get().paymentIntent?.intent_id !== paymentIntent.intent_id) return;
        // Confirm the provider's terminal outcome before offering another method.
        try {
          const observed = await api.getPaymentStatus(paymentIntent.intent_id);
          if (get().api !== api || get().cartUpdating || get().paymentIntent?.intent_id !== paymentIntent.intent_id) return;
          if (get().shippingMode === "marketplace" || Object.hasOwn(observed, "checkout_status") || get().paymentIntent?.checkout_status !== undefined) {
            applyMarketplaceStatus(observed, paymentIntent.intent_id);
          } else if (paymentPollingOutcome(observed.status) === "failed") {
            get().stopPolling();
            applyTerminalPaymentStatus(observed.status, paymentIntent.intent_id);
          }
        } catch { /* Keep observing the same payment when confirmation is unavailable. */ }
      },
      onError: () => {
        startPolling();
      },
    });
  },

  reportPaymentFailure: async (intentId) => {
    const state = get();
    const { api, sessionId, triggerConfig } = state;
    if (!api || !sessionId || state.paymentObservation || state.status === "completed" || state.paymentIntent?.intent_id !== intentId) return;
    const id = `payment_failed_${sessionId}_${intentId}`;
    if (state.messages.some(message => message.id === id)) return;
    get().recordCheckoutDifficulty();
    const marketplace = state.shippingMode === "marketplace" || state.paymentIntent.checkout_status !== undefined;
    set(current => ({ messages: [...current.messages, { id, role: "agent", timestamp: Date.now(),
      text: marketplace ? "O pagamento não foi aprovado. Confira o estado desta operação para continuar com segurança."
        : "O pagamento não foi aprovado. Você pode revisar os dados ou escolher outra forma de pagamento." }] }));
    const result = await trackEvent("payment_failed", { intent_id: intentId });
    const live = get();
    if (live.api !== api || live.sessionId !== sessionId || live.paymentObservation || live.status === "completed" || live.paymentIntent?.intent_id !== intentId) return;
    if (!triggerConfig?.enabledTriggers.includes("payment_failed") || triggerConfig.mode === "manual_only" || result?.trigger_agent !== true) return;
    const custom = live.triggerMessages?.payment_failed;
    const methods = marketplace ? [] : paymentMethodsForConfig(live.merchantPaymentConfig);
    set(current => ({ messages: current.messages.map(message => message.id === id ? { ...message,
      text: custom?.message?.trim() || (marketplace
        ? "O pagamento não foi aprovado. Confira o estado desta operação para continuar com segurança."
        : "O pagamento não foi aprovado. Escolha uma das formas de pagamento disponíveis para tentar novamente."),
      ...(methods.length ? { blocks: [{ type: "payment_methods", data: { methods } }] as ChatBlock[] } : {}),
    } : message) }));
  },

  showCheckoutHelp: (kind, explicit = false, sku) => {
    const state = get();
    if (!state.api || state.status !== "active" || state.paymentObservation ||
      (!explicit && state.triggerConfig?.mode === "manual_only")) return;
    const flag = kind === "stock" ? "unavailableProduct" : kind === "human" ? "humanHandoff" : kind;
    if (!state.assistance[flag] || kind === "human" && !state.handoffEnabled) return;
    const intent = state.paymentIntent;
    const id = `help_${kind}_${state.sessionId}_${intent?.intent_id ?? sku ?? "checkout"}`;
    if (!explicit && state.messages.some(message => message.id === id)) return;
    let text: string;
    let actions: HelpChoice[];
    if (kind === "pix") {
      if (intent?.method !== "pix") {
        text = "Ainda não há um Pix gerado neste checkout. Escolha Pix nas formas de pagamento para receber o código.";
        actions = [];
      } else {
        const expired = ["expired", "cancelled", "failed"].includes(intent.status);
        const pending = paymentPollingOutcome(intent.status) === "pending";
        const codeValid = pending && Boolean(intent.pix_code) &&
          (intent.expires_at_unix === undefined || intent.expires_at_unix * 1000 > Date.now());
        text = expired ? "Este Pix encerrou. Podemos consultar o estado do pagamento e, quando permitido, gerar um novo código."
          : codeValid ? "Se você já pagou, posso consultar a confirmação. Se ainda não pagou, posso mostrar o mesmo código Pix."
          : pending ? "O código Pix não está disponível para pagamento agora. Vamos consultar a confirmação antes de continuar."
          : paymentPollingOutcome(intent.status) === "completed" ? "O pagamento recebeu confirmação. Consulte o estado do pedido para acompanhar a conclusão."
          : "Este Pix está encerrado. Consulte a situação desta operação ou peça ajuda à equipe da loja.";
        actions = [{ action: "check_payment", label: "Consultar pagamento" },
          ...(codeValid ? [{ action: "show_pix" as const, label: "Mostrar código Pix" }] : []),
          ...(!codeValid && (expired || pending && intent.expires_at_unix !== undefined && intent.expires_at_unix * 1000 <= Date.now()) && state.shippingMode === "standard" ? [{ action: "renew_pix" as const, label: "Consultar e renovar Pix" }] : [])];
      }
    } else if (kind === "installments") {
      const cardAvailable = paymentMethodsForConfig(state.merchantPaymentConfig).some(method => method.key === "credito");
      const provider = state.merchantPaymentConfig.paymentMethods?.providers?.card;
      text = !cardAvailable ? "Esta loja não disponibiliza cartão neste checkout. As formas disponíveis aparecem na etapa de pagamento."
        : state.shippingMode === "marketplace" || provider === "stripe" || !provider && !intent?.invoice_url
          ? "O cartão está disponível à vista neste checkout. Não há uma opção de parcelamento confirmada para este pedido."
          : "As condições de cartão disponíveis para este pedido são apresentadas no ambiente seguro de pagamento, antes de você confirmar a cobrança.";
      actions = cardAvailable && !intent ? [{ action: "card_conditions", label: "Ver formas de pagamento" }] : [];
    } else if (kind === "stock") {
      text = "A quantidade ou o produto escolhido não está mais disponível. Você pode revisar o carrinho ou consultar outras opções com estoque na loja.";
      actions = [{ action: "review_cart", label: "Revisar carrinho" }, { action: "alternatives", label: "Ver alternativas disponíveis" }];
    } else {
      text = "Ainda não conseguimos concluir esta etapa. Quer pedir ajuda à equipe da loja?";
      actions = [{ action: "human", label: "Falar com atendente" }];
    }
    set(current => ({ messages: [...current.messages, { id: explicit ? `${id}_${Date.now()}_${current.messages.length}` : id,
      role: "agent", text, timestamp: Date.now(), blocks: actions.length ? [{ type: "checkout_help", data: {
        actions, intent_id: kind === "pix" ? intent?.intent_id : undefined,
        cart_context: kind === "stock" || kind === "installments" ? JSON.stringify(current.cart.items) : undefined, sku,
        session_id: current.sessionId,
      } }] : undefined }] }));
  },

  recordCheckoutDifficulty: error => {
    if (get().paymentObservation || get().status !== "active") return;
    set(state => ({ assistanceFailures: state.assistanceFailures + 1 }));
    if (isStockError(error)) {
      const sku = error && typeof error === "object" && "details" in error
        ? (error.details as { sku?: string } | undefined)?.sku : undefined;
      get().showCheckoutHelp("stock", false, sku);
    }
    if (get().assistanceFailures >= 2) get().showCheckoutHelp("human");
  },

  runHelpAction: async (action, intentId, cartContext, sku) => {
    const state = get(), { api, sessionId } = state;
    if (!api || state.status !== "active" || state.paymentObservation || state.assistanceBusy || state.paymentSubmitting || state.cartUpdating || state.isTyping || state.chatRecovery || api.requiresChatRecovery || state.pendingPriceReview || state.paymentCancellationPending ||
        intentId && state.paymentIntent?.intent_id !== intentId || cartContext && JSON.stringify(state.cart.items) !== cartContext) return;
    const current = () => get().api === api && get().sessionId === sessionId && get().status === "active" &&
      !get().paymentObservation && (!intentId || get().paymentIntent?.intent_id === intentId) && (!cartContext || JSON.stringify(get().cart.items) === cartContext);
    const reply = (text: string, blocks?: ChatBlock[]) => {
      if (current()) set(live => ({ messages: [...live.messages, { id: `help_result_${Date.now()}_${live.messages.length}`,
        role: "agent", text, blocks, timestamp: Date.now() }] }));
    };
    if (action === "human") {
      if (!state.assistance.humanHandoff || !state.handoffEnabled) return;
      set({ supportRequest: { id: `${sessionId}_${Date.now()}`, message: "Preciso falar com um atendente humano para concluir minha compra." } });
      return;
    }
    if (action === "review_cart") {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aacp:review-cart"));
      return;
    }
    if (action === "card_conditions") {
      if (state.assistance.installments && !state.paymentIntent) reply("Estas são as formas disponíveis. Confirme o frete e seus dados antes de pagar.",
        [{ type: "payment_methods", data: { methods: paymentMethodsForConfig(state.merchantPaymentConfig) } }]);
      return;
    }
    set({ assistanceBusy: true });
    try {
      if (action === "alternatives" && state.assistance.unavailableProduct) {
        const item = state.cart.items.find(item => item.sku === sku) ?? state.cart.items[0];
        const candidates = await api.searchAvailableAlternatives(item?.category || item?.name.split(/\s+/)[0] || "produto");
        const products = candidates.filter(product => !state.cart.items.some(item => item.sku === product.sku));
        reply(products.length ? "Encontrei estas opções com estoque na loja. Você pode escolher uma alternativa ou revisar o carrinho. A troca só acontece quando você confirmar no botão."
          : "Não encontrei uma alternativa disponível agora. Você pode revisar o carrinho ou pedir ajuda à loja.",
          products.length ? [{ type: "checkout_alternatives", data: { products, cart_context: JSON.stringify(state.cart.items), session_id: sessionId,
            replace_sku: sku && item?.sku === sku ? sku : undefined, replace_variant: sku && item?.sku === sku ? item.variant : undefined } }] : undefined);
      } else if (["check_payment", "show_pix", "renew_pix"].includes(action) && state.assistance.pix && state.paymentIntent?.method === "pix") {
        const intent = state.paymentIntent;
        if (action === "renew_pix") {
          if (state.shippingMode !== "standard") return;
          await api.prepareExpiredPixRenewal(intent.intent_id, current);
          if (!current()) return;
          state.stopPolling();
          await get().pay("pix", undefined, undefined, current);
        } else {
          const observed = await api.getPaymentStatus(intent.intent_id);
          if (!current()) return;
          if (state.shippingMode === "marketplace" || observed.checkout_status !== undefined || intent.checkout_status !== undefined) applyMarketplaceStatus(observed, intent.intent_id);
          else if (paymentPollingOutcome(observed.status) === "completed") {
            state.stopPolling(); set({ paymentIntent: { ...intent, status: observed.status }, status: "completed", cart: { ...get().cart, status: "paid" } }); return;
          } else { set({ paymentIntent: { ...intent, status: observed.status } }); }
          if (!current()) return;
          if (paymentPollingOutcome(observed.status) === "failed") {
            state.stopPolling();
            if (observed.status === "failed" && state.shippingMode === "standard" && observed.checkout_status === undefined && intent.checkout_status === undefined) {
              set(live => ({ cart: { ...live.cart, status: "ready_to_pay" } }));
              await get().reportPaymentFailure(intent.intent_id);
              if (!current()) return;
            }
            get().showCheckoutHelp("pix", true);
          } else if (paymentPollingOutcome(observed.status) === "completed") {
            reply("O pagamento recebeu confirmação. Vou acompanhar a conclusão do pedido.");
          } else if (action === "show_pix" && intent.pix_code &&
              (intent.expires_at_unix === undefined || intent.expires_at_unix * 1000 > Date.now())) {
            reply("Este é o código da mesma operação Pix.", [{ type: "pix_payment", data: { ...intent,
              ...(state.shippingMode === "marketplace" ? { marketplace_context: state.marketplacePaymentAttemptContext } : {}) } }]);
          } else reply("A confirmação deste pagamento ainda não chegou. Vou continuar acompanhando a mesma operação.");
        }
      }
    } catch {
      reply(action === "renew_pix" ? "Ainda não foi possível confirmar a renovação do Pix. Consulte o pagamento antes de tentar novamente."
        : "Não consegui consultar esta informação agora. Tente novamente em instantes.");
    } finally { if (get().api === api && get().sessionId === sessionId) set({ assistanceBusy: false }); }
  },

  addAlternative: async (sku, cartContext, replaceSku, replaceVariant) => {
    const state = get(), { api, sessionId } = state;
    if (!api || !state.assistance.unavailableProduct || state.status !== "active" || state.paymentObservation ||
      state.shippingMode === "marketplace" || state.paymentIntent && paymentPollingOutcome(state.paymentIntent.status) === "pending" ||
      state.cartUpdating || state.assistanceBusy || state.paymentSubmitting || state.paymentCreating || state.isTyping || state.chatRecovery || api.requiresChatRecovery || state.pendingPriceReview || state.paymentCancellationPending || JSON.stringify(state.cart.items) !== cartContext) return;
    set({ cartUpdating: true });
    try {
      const result = await api.addCatalogAlternative(sku, replaceSku, replaceVariant);
      if (get().api !== api || get().sessionId !== sessionId || get().paymentObservation || get().status !== "active" || JSON.stringify(get().cart.items) !== cartContext) return;
      state.stopPolling();
      set(live => ({ cart: { ...cartFromExperience(result.experience), shipping: undefined, status: "awaiting" }, paymentIntent: null, assistanceFailures: 0, activeDiscount: null,
        messages: [...live.messages.map(message => ({ ...message, blocks: message.blocks?.filter(block => !["pix_payment", "hosted_card_payment", "boleto_payment", "stripe_card", "crypto_payment", "crypto_chain_select", "shipping_options", "payment_methods", "coupon_input"].includes(block.type)) })),
          { id: `alternative_${Date.now()}`, role: "agent", text: replaceSku ? "Produto trocado por uma unidade da alternativa escolhida. Revise o carrinho e confirme novamente a entrega antes de pagar."
            : "Alternativa adicionada. Revise os itens do carrinho e confirme novamente a entrega antes de pagar.", timestamp: Date.now() }] }));
    } catch (error) { if (get().api === api) { set({ cartError: "Não foi possível adicionar esta alternativa. Seus itens foram mantidos." }); get().recordCheckoutDifficulty(error); } }
    finally { if (get().api === api) set({ cartUpdating: false }); }
  },

  stopPolling: () => {
    if (wsCleanup) {
      wsCleanup();
      wsCleanup = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ paymentPolling: false });
  },

  setActiveDiscount: (stage, percent, couponCode?, message?) => {
    set((s) => ({
      activeDiscount: { stage, percent, couponCode, message },
      cart: percent > 0
        ? { ...s.cart, totalToPay: undefined, discount: Math.round((s.cart.total * (percent / 100)) * 100) / 100 }
        : s.cart,
    }));
  },

  dismissDiscount: () => {
    // Closing the presentation must never discard a benefit already authorized
    // and persisted by the API; it only hides the local notice.
    set({ activeDiscount: null });
  },

  applyCouponCode: async (code) => {
    const { api, cart } = get();
    if (!api) return { ok: false, error: "Sessão não iniciada" };
    try {
      const result = await api.applyCoupon(code.trim().toUpperCase(), {
        items: cart.items.map((it) => ({ sku: it.sku, name: it.name, price: it.price, quantity: it.quantity })),
        total: cart.total,
      });
      const nextCart = result.experience
        ? cartFromExperience(result.experience)
        : { ...cart, totalToPay: undefined, discount: result.discount_applied ?? 0 };
      const nudge = result.experience?.commercial_nudge;
      set({
        cart: { ...nextCart, status: get().cart.status },
        pendingPriceReview: null,
        activeDiscount: activeDiscountFromNudge(nudge),
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || "Cupom inválido ou expirado" };
    }
  },

  proceedToPayment: (methods) => {
    const s = get();
    const permitted = paymentMethodsForConfig(s.merchantPaymentConfig);
    const permittedKeys = new Set(permitted.map((method) => method.key));
    const requested = methods?.filter((method) => permittedKeys.has(method.key)) ?? [];
    const list = requested.length > 0 ? requested : permitted;
    set((st) => ({
      messages: [...st.messages, {
        id: `agent_pay_${Date.now()}`,
        role: "agent",
        text: "Como você quer pagar?",
        blocks: [{ type: "payment_methods", data: { methods: list } }],
        timestamp: Date.now(),
      }],
      cart: { ...st.cart, status: "ready_to_pay" },
    }));
  },

  /**
   * Progressive discount: map checkout cart status → discount stage → percent.
   * Fires the DiscountBanner with increasing percent as the buyer advances.
   * Only activates when merchant has progressiveDiscount.enabled.
   */
  applyProgressiveDiscount: async (cartStatus) => {
    const { progressiveDiscount } = get();
    if (!progressiveDiscount?.enabled) return;

    const eventMap: Record<string, string> = {
      awaiting: "coupon_field_clicked",
      shipping_calculated: "checkout_abandoned",
      ready_to_pay: "payment_method_selected",
    };
    const stageMap: Record<string, DiscountStage> = {
      awaiting: "initial_coupon",
      shipping_calculated: "abandoned_cart",
      ready_to_pay: "payment_nudge",
    };
    const event = eventMap[cartStatus];
    const stage = stageMap[cartStatus];
    if (!event || !stage) return;

    const result = await trackEvent(event as never);
    const approved = result?.progressive_offer?.approved_percent ?? 0;
    if (approved <= 0) return;
    const message = `Desconto progressivo aprovado: ${approved}% foi aplicado a este checkout.`;
    get().setActiveDiscount(stage, approved, undefined, message);
  },

  evaluateAdvancedRules: () => {
    const { advancedRules, cart, buyer } = get();
    if (!advancedRules.length) return;
    const context = {
      cart: { items: cart.items, total: cart.total },
      buyer: { isReturning: buyer.isReturning, purchaseCount: buyer.purchaseCount },
      session: { stage: "active" },
    };
    const actions = evaluateRules(advancedRules, context);
    set({ activeRuleActions: actions });
  },

  resetSession: () => {
    resetTriggers();
    if (wsCleanup) { wsCleanup(); wsCleanup = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    set({
      status: "loading",
      assistance: { ...DEFAULT_ASSISTANCE }, handoffEnabled: true, assistanceFailures: 0, assistanceBusy: false, supportRequest: null, shippingMode: "standard", paymentObservation: false,
      api: null,
      sessionId: null,
      chatRecovery: null,
      chatResponseUnavailable: false,
      isTyping: false,
      cart: { items: [], total: 0, serviceFee: 0, discount: 0, status: "awaiting" },
      messages: [],
      paymentIntent: null,
      pendingPriceReview: null,
      paymentSubmitting: false,
      paymentCancellationPending: null,
      paymentPolling: false,
      paymentCreating: false,
      cartUpdating: false,
      cartError: null,
      activeDiscount: null,
      oneBuyClickPreferences: null,
      leadRegistered: false,
      pendingPayment: null,
      error: null,
    });
  },
}));
