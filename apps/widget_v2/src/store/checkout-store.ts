import { create } from "zustand";
import {
  CheckoutSession,
  crossSellBlockFromSuggestions,
  type BrandConfig,
  type AgentConfig,
  type CartItem,
  type ChatBlock,
  type PaymentIntent,
  type CryptoPaymentsConfig,
} from "@/api/checkout-session";
import {
  initTracking,
  trackEvent,
} from "@/lib/tracking";
import type { TriggerConfig, TriggerName } from "@/lib/triggers";
import type { AdvancedRule, RuleAction } from "@/lib/advanced-rules";
import { evaluateRules } from "@/lib/advanced-rules";
import type { DiscountStage } from "@/components/DiscountBanner";
import { connectPaymentWs } from "@/lib/payment-ws";

export type CheckoutStatus = "loading" | "channel_gate" | "active" | "error" | "completed";
export type CartStatus = "awaiting" | "shipping_calculated" | "ready_to_pay" | "paid";

export interface ShippingOption {
  key: string;
  label: string;
  tag: string;
  sub: string;
  cost: number;
}

export interface PaymentMethod {
  key: string;
  label: string;
  sub: string;
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

export interface CartState {
  items: CartItem[];
  total: number;
  shipping?: { key: string; label: string; cost: number };
  discount: number;
  status: CartStatus;
}

export interface Message {
  id: string;
  role: "agent" | "user";
  text?: string;
  blocks?: ChatBlock[];
  quickReplies?: string[];
  timestamp: number;
}

interface CheckoutState {
  // Status
  status: CheckoutStatus;
  error: string | null;

  // Session
  sessionId: string | null;
  api: CheckoutSession | null;

  // Merchant config (from API)
  brand: BrandConfig;
  agent: AgentConfig;
  merchantPaymentConfig: { stripeEnabled?: boolean; cryptoPaymentsEnabled?: boolean; cryptoPayments?: CryptoPaymentsConfig };

  // Buyer (pre-authenticated via global_user_id)
  buyer: BuyerData;

  // Cart
  cart: CartState;

  // Chat — the MAIN interaction surface
  messages: Message[];
  isTyping: boolean;
  channel: "chat" | "voice";

  // Payment
  paymentIntent: PaymentIntent | null;
  paymentPolling: boolean;

  // Triggers & Interventions
  triggerConfig: TriggerConfig | null;
  triggerMessages: Record<string, { message?: string; couponCode?: string }> | null;
  activeDiscount: { stage: DiscountStage; percent: number; couponCode?: string; message?: string } | null;
  progressiveDiscount: { enabled: boolean; stages: Record<string, number> } | null;
  advancedRules: AdvancedRule[];
  activeRuleActions: RuleAction[];

  // Cross-sell (deferred from start → rendered at selectChannel)
  _pendingCrossSellBlock: ChatBlock | null;

  // Whitelabel: "Powered by Zyon" badge shown for free-plan merchants
  showBranding: boolean;

  // Actions
  init: (params: { embedToken: string; merchantId: string; cartRef?: string; apiBaseUrl: string; globalUserId?: string }) => Promise<void>;
  selectChannel: (channel: "chat" | "voice") => void;
  sendMessage: (text: string) => Promise<void>;
  updateQty: (sku: string, quantity: number) => Promise<void>;
  removeCartItem: (sku: string) => Promise<void>;
  selectShipping: (key: string) => Promise<void>;
  pay: (method: "pix" | "credito" | "debito" | "crypto", installments?: number) => Promise<void>;
  selectCryptoChain: (chain: "polygon" | "base") => Promise<void>;
  pollPayment: () => void;
  stopPolling: () => void;
  setActiveDiscount: (stage: DiscountStage, percent: number, couponCode?: string, message?: string) => void;
  dismissDiscount: () => void;
  applyProgressiveDiscount: (cartStatus: CartStatus) => void;
  evaluateAdvancedRules: () => void;
  resetSession: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsCleanup: (() => void) | null = null;
const MAX_POLL_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

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
    case "crypto_chain_select":
      return "Escolha a rede para pagar com cripto:";
    case "crypto_payment":
      return "Envie o valor para o endereço abaixo para concluir o pagamento:";
    case "stripe_card":
      return "Preencha os dados do seu cartão para finalizar:";
    case "address_confirmation":
      return "Confirme seu endereço de entrega:";
    case "form_field":
      return null; // form_field blocks carry their own label
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
  state: { buyer: BuyerData; cart: CartState; merchantPaymentConfig: { stripeEnabled?: boolean; cryptoPaymentsEnabled?: boolean; cryptoPayments?: CryptoPaymentsConfig } },
): ChatBlock[] | undefined {
  if (!stage) return undefined;

  if (stage === "shipping" || stage === "delivery") {
    // Address already confirmed → shipping was calculated. Don't re-show the
    // address card (that caused the confirm→confirm loop). Nothing to derive;
    // the backend/selectShipping flow drives shipping_options from here.
    if (state.cart.status === "shipping_calculated" || state.cart.status === "ready_to_pay") {
      return undefined;
    }
    const addr = state.buyer.address;
    const hasCompleteAddress = Boolean(addr?.zip && addr?.street && addr?.number && addr?.city && addr?.state);
    if (hasCompleteAddress && addr) {
      const addrLine = `${addr.street}, ${addr.number}${addr.complement ? ', ' + addr.complement : ''} - ${addr.city}/${addr.state}`;
      return [{ type: "address_confirmation", data: { address: addr, formatted: addrLine } }];
    }
    // Missing address → ask for CEP
    return [{ type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } }];
  }

  if (stage === "payment") {
    const methods: Array<{ key: string; label: string; sub: string }> = [];
    methods.push({ key: "pix", label: "Pix", sub: "Pagamento instantâneo, sem taxas" });
    methods.push({ key: "credito", label: "Cartão de crédito", sub: "Parcele em até 12x sem juros" });
    methods.push({ key: "debito", label: "Cartão de débito", sub: "Débito à vista" });
    if (state.merchantPaymentConfig.cryptoPaymentsEnabled) {
      const token = state.merchantPaymentConfig.cryptoPayments?.token || "USDC";
      const chain = state.merchantPaymentConfig.cryptoPayments?.chain || "polygon";
      methods.push({ key: "crypto", label: `Crypto · ${token}`, sub: `Liquida na ${chain} + cashback` });
    }
    return [{ type: "payment_methods", data: { methods } }];
  }

  return undefined;
}

function startPolling(): void {
  const state = useCheckoutStore.getState();
  const { api, paymentIntent } = state;
  if (!api || !paymentIntent || !paymentIntent.intent_id) return;

  const pollStartTime = Date.now();
  pollTimer = setInterval(async () => {
    if (Date.now() - pollStartTime > MAX_POLL_DURATION_MS) {
      useCheckoutStore.getState().stopPolling();
      // Session expired — full reset to avoid stale cart/payment state
      useCheckoutStore.getState().resetSession();
      return;
    }
    try {
      const status = await api.getPaymentStatus(paymentIntent.intent_id);
      // API PaymentIntentStatus terminal-success value is "approved"
      // (webhook flips requires_action → approved). "paid"/"confirmed"
      // kept for backward compat with any legacy provider mapping.
      if (
        status.status === "approved" ||
        status.status === "paid" ||
        status.status === "confirmed"
      ) {
        useCheckoutStore.getState().stopPolling();
        void trackEvent("order_completed", {
          intent_id: paymentIntent.intent_id,
        });
        useCheckoutStore.setState({
          cart: { ...useCheckoutStore.getState().cart, status: "paid" },
          status: "completed",
        });
      } else if (status.status === "failed" || status.status === "cancelled") {
        useCheckoutStore.getState().stopPolling();
        // Payment terminal failure — reset session to avoid stale state
        useCheckoutStore.getState().resetSession();
      }
    } catch {
      // continue polling
    }
  }, 3000);
}

export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  status: "loading",
  error: null,
  sessionId: null,
  api: null,
  brand: {},
  agent: {},
  merchantPaymentConfig: {},
  buyer: {},
  cart: { items: [], total: 0, discount: 0, status: "awaiting" },
  messages: [],
  isTyping: false,
  channel: "chat",
  paymentIntent: null,
  paymentPolling: false,
  triggerConfig: null,
  triggerMessages: null,
  activeDiscount: null,
  progressiveDiscount: null,
  advancedRules: [],
  activeRuleActions: [],
  _pendingCrossSellBlock: null,
  showBranding: false,

  init: async ({ embedToken, merchantId, cartRef, apiBaseUrl, globalUserId }) => {
    try {
      const api = new CheckoutSession({ embedToken, merchantId, cartRef, apiBaseUrl, globalUserId });
      set({ api, status: "loading" });

      const response = await api.start();
      const exp = response.experience;

      // Fetch real cart items from storefront cart endpoint (not from embed/start)
      const cartData = await api.fetchCart();
      const items = cartData.items;
      // W2-006: Server total is authoritative; client-side reduce is a display-only fallback.
      // Payment intent is computed server-side from the session — see createPaymentIntent() which
      // sends only session_id, never a client-computed amount.
      const total = cartData.total || items.reduce((sum, i) => sum + i.price * i.quantity, 0);

      // Buyer data comes pre-resolved from API (via global_user_id in token)
      const buyerSource = exp?.buyer ?? exp?.customer;
      const buyer: BuyerData = {
        name: buyerSource?.name ?? buyerSource?.fullName,
        email: buyerSource?.email,
        phone: buyerSource?.phone,
        cpf: buyerSource?.cpf,
        isReturning: buyerSource?.isReturning,
        purchaseCount: buyerSource?.purchaseCount,
        address: buyerSource?.address,
      };

      // Flatten brand: API returns brand at top level AND theme nested inside.
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
      };

      set({
        sessionId: response.session_id,
        brand,
        agent,
        buyer,
        merchantPaymentConfig: {
          stripeEnabled: exp?.stripeEnabled ?? rawBrand.stripeEnabled ?? true,
          cryptoPaymentsEnabled: exp?.cryptoPaymentsEnabled ?? rawBrand.cryptoPaymentsEnabled ?? false,
          cryptoPayments: exp?.cryptoPayments ?? rawBrand.cryptoPayments,
        },
        cart: { items, total, discount: 0, status: "awaiting" },
        status: "channel_gate",
        error: null,
        _pendingCrossSellBlock: crossSellBlockFromSuggestions(exp?.suggestedProducts),
        showBranding: exp?.rules?.showBranding ?? false,
      });

      // Initialize tracking
      initTracking(api, response.session_id);
      void trackEvent("checkout_started");

      // Fetch checkout settings for triggers
      try {
        const settingsRes = await fetch(
          `${apiBaseUrl}/checkout-settings/widget-config?merchantId=${encodeURIComponent(merchantId)}`
        );
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          set({
            triggerConfig: {
              enabledTriggers: (settings.enabledTriggers ?? []) as TriggerName[],
              cooldownMs: (settings.cooldownSeconds ?? 120) * 1000,
              maxInterventions: settings.maxInterventionsPerSession ?? 3,
              idleSeconds: settings.idleSeconds ?? 30,
            },
            triggerMessages: settings.triggerMessages ?? null,
            progressiveDiscount: settings.progressiveDiscount ?? null,
            advancedRules: settings.advancedRules ?? [],
          });
        }
      } catch {
        /* silent — triggers are non-critical */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown_error";
      set({ status: "error", error: msg });
    }
  },

  selectChannel: (_channel) => {
    void trackEvent("channel_selected", { channel: _channel });

    // Add welcome message from agent with quick replies
    const { cart, _pendingCrossSellBlock } = get();

    const welcomeText = cart.items.length > 0
      ? `Vi que você tem ${cart.items.length} ${cart.items.length === 1 ? 'item' : 'itens'} no carrinho. Vamos finalizar sua compra?`
      : `Olá, estou aqui para te ajudar a encontrar o produto ideal.`;

    const messages: Message[] = [
      {
        id: "welcome",
        role: "agent",
        text: welcomeText,
        quickReplies: ["Vamos prosseguir", "Quero voltar"],
        timestamp: Date.now(),
      },
    ];

    // Render cross-sell suggestions from checkout start (pre_payment touchpoint).
    // Always pair the component with narration so the agent "speaks" instead of
    // silently dropping a product block.
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
      messages,
      _pendingCrossSellBlock: null,
    });
    // Progressive discount: initial stage when checkout becomes active.
    get().applyProgressiveDiscount("awaiting");
  },

  sendMessage: async (text) => {
    // Handle "Quero voltar" — navigate back
    if (text === "Quero voltar") {
      window.history.back();
      return;
    }

    const { api, messages } = get();
    if (!api) return;

    // Add user message
    const userMsg: Message = {
      id: `user_${Date.now()}`,
      role: "user",
      text,
      timestamp: Date.now(),
    };
    set({ messages: [...messages, userMsg], isTyping: true });

    // Address confirmation is a LOCAL UI action — handle before hitting the LLM.
    // The buyer said "Sim"/"Correto" to the address card → fetch shipping quote
    // and show options directly, skipping the chat round-trip (which would return
    // a text-only "Benefício aplicado" with no blocks).
    const normalizedConfirm = text.trim().toLowerCase().replace(/[.!?,;]+$/, "");
    const isAddrConfirm = ["sim", "correto", "confirmo", "certo", "isso", "é esse", "esse mesmo"].includes(normalizedConfirm);
    if (isAddrConfirm) {
      const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
      if (lastAgentMsg?.blocks?.some((b) => b.type === "address_confirmation")) {
        const { buyer } = get();
        const zip = buyer.address?.zip || "00000000";
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

    // Shipping selection is a LOCAL UI action — show payment methods directly.
    // The "Entrega · X" message is sent after selectShipping(key) already hit the
    // backend; the next step is always payment methods, no LLM needed.
    if (text.startsWith("Entrega ·")) {
      const { merchantPaymentConfig } = get();
      const methods: Array<{ key: string; label: string; sub: string }> = [];
      methods.push({ key: "pix", label: "Pix", sub: "Pagamento instantâneo, sem taxas" });
      methods.push({ key: "credito", label: "Cartão de crédito", sub: "Parcele em até 12x sem juros" });
      methods.push({ key: "debito", label: "Cartão de débito", sub: "Débito à vista" });
      if (merchantPaymentConfig.cryptoPaymentsEnabled) {
        const token = merchantPaymentConfig.cryptoPayments?.token || "USDC";
        const chain = merchantPaymentConfig.cryptoPayments?.chain || "polygon";
        methods.push({ key: "crypto", label: `Crypto · ${token}`, sub: `Liquida na ${chain} + cashback` });
      }
      set((s) => ({
        messages: [...s.messages, {
          id: `agent_${Date.now()}`, role: "agent",
          text: "Frete selecionado! Agora escolha como quer pagar:",
          blocks: [{ type: "payment_methods", data: { methods } }],
          timestamp: Date.now(),
        }],
        isTyping: false,
        cart: { ...s.cart, status: "shipping_calculated" },
      }));
      get().applyProgressiveDiscount("shipping_calculated");
      return;
    }

    try {
      const res = await api.chat(text);

      // If API returns empty blocks for "Vamos prosseguir", provide shipping options
      if ((!res.blocks || res.blocks.length === 0) && text === "Vamos prosseguir") {
        // Buyer is pre-authenticated — skip data collection, go to shipping
        const { buyer } = get();

        // Check if address is complete (all fields populated)
        const addr = buyer.address;
        const hasCompleteAddress = Boolean(
          addr?.zip && addr?.street && addr?.number && addr?.city && addr?.state
        );

        // If address is incomplete, ask for CEP first
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

        // Address is complete — show address confirmation before auto-quoting
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

      // Handle address confirmation — user said "Não" (wants to correct address)
      if (text === "Não" && messages.length > 0) {
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

      // Render agent response with message text and blocks.
      // Primary: backend LLM navigation tools emit UI blocks (res.blocks).
      // Fallback: derive from reported stage when the LLM didn't call a tool.
      // Both make voice/free-text chat show the same components as buttons.
      const { buyer, cart, merchantPaymentConfig } = get();
      const baseBlocks = res.blocks && res.blocks.length > 0
        ? res.blocks
        : (deriveBlocksFromStage(res.stage, { buyer, cart, merchantPaymentConfig }) ?? []);
      // Cross-sell arrives via experience.suggestedProducts (not blocks[]) — merge it in
      // so the existing cross_sell renderer picks it up (pre_payment touchpoint).
      const crossSellBlock = crossSellBlockFromSuggestions(res.experience?.suggestedProducts);
      const mergedBlocks = crossSellBlock
        ? [...baseBlocks, crossSellBlock]
        : baseBlocks;
      // Universal narration: when the LLM returned empty text but there are
      // interactive blocks, derive a human-readable line from the first block.
      const agentText = resolveAgentText(res.message, mergedBlocks);
      const agentMsg: Message = {
        id: `agent_${Date.now()}`,
        role: "agent",
        text: agentText,
        blocks: mergedBlocks,
        quickReplies: res.quick_replies,
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, agentMsg],
        isTyping: false,
      }));

      // Update cart from cart_summary block
      const cartBlock = res.blocks?.find((b) => b.type === "cart_summary");
      if (cartBlock?.data) {
        const items = (cartBlock.data.items as CartItem[]) || [];
        const total = (cartBlock.data.total as number) || 0;
        set((s) => ({
          cart: { ...s.cart, items, total, discount: (cartBlock.data!.discount as number) || 0 },
        }));
      }

      // Update cart from shipping_confirmed block
      const shippingConfirm = res.blocks?.find((b) => b.type === "shipping_confirmed");
      if (shippingConfirm?.data) {
        set((s) => ({
          cart: {
            ...s.cart,
            status: "shipping_calculated",
            shipping: shippingConfirm.data as { key: string; label: string; cost: number },
          },
        }));
      }

      // Update cart status from pix_payment block (ready to pay)
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

      // Order confirmation → completed
      const orderBlock = res.blocks?.find((b) => b.type === "order_confirmation");
      if (orderBlock) {
        set({ status: "completed", cart: { ...get().cart, status: "paid" } });
      }
    } catch (err) {
      console.error("[WIDGET-CHAT] embed/chat failed:", err);
      // API failed — show error message (don't show fake shipping options
      // that have no backend quote, as selectShipping would fail)
      const { cart, buyer, merchantPaymentConfig } = get();
      if (text === "Vamos prosseguir" && cart.items.length > 0) {
        // Try to fetch shipping quote directly even if chat failed
        try {
          const zip = buyer.address?.zip || "00000000";
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
      // If shipping is already calculated, the user is at the payment stage.
      // Show payment methods locally so voice/free-text users aren't stuck.
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

  updateQty: async (sku, quantity) => {
    const { api, cart } = get();
    if (!api) return;

    // Capture old qty for tracking
    const oldItem = cart.items.find((item) => item.sku === sku);
    const oldQty = oldItem?.quantity ?? 0;

    // Optimistic local update
    const updatedItems = cart.items.map((item) =>
      item.sku === sku ? { ...item, quantity } : item
    );
    const newTotal = updatedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    set({ cart: { ...cart, items: updatedItems, total: newTotal } });

    // Track event
    void trackEvent("item_quantity_updated", {
      sku,
      old_qty: oldQty,
      new_qty: quantity,
    });

    // Server sync via PATCH /storefront/cart/:cartId/items/:variantId
    try {
      await api.updateCartItemQty(sku, quantity);
    } catch {
      // Revert on failure
      set({ cart });
    }
  },

  removeCartItem: async (sku) => {
    const { api, cart } = get();

    // Optimistic local update (always works regardless of API)
    const updatedItems = cart.items.filter((item) => item.sku !== sku);
    const newTotal = updatedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    set({ cart: { ...cart, items: updatedItems, total: newTotal } });

    // Track event
    void trackEvent("item_removed", { sku });

    // Server sync: set quantity to 0 = remove
    if (api) {
      try {
        await api.updateCartItemQty(sku, 0);
      } catch {
        // Revert on failure
        set({ cart });
      }
    }
  },

  selectShipping: async (key: string) => {
    const { api } = get();
    if (!api) return;
    console.log('[WIDGET-DBG] selectShipping called', { key });
    try {
      const result = await api.selectShipping(key);
      console.log('[WIDGET-DBG] selectShipping success', { key, result });
      set((s) => ({
        cart: {
          ...s.cart,
          shipping: {
            key,
            label: result.shipping?.method ?? key,
            cost: Math.round((result.shipping?.customerPrice ?? 0) * 100),
          },
          status: "shipping_calculated",
        },
      }));
      get().applyProgressiveDiscount("shipping_calculated");
      void trackEvent("shipping_option_selected", { key });
    } catch (err) {
      console.error('[WIDGET-DBG] selectShipping failed', { key, error: err });
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Não foi possível confirmar o frete. Tente novamente.",
        quickReplies: ["Tentar novamente"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
    }
  },

  pay: async (method, installments) => {
    const { api, buyer, cart } = get();
    if (!api) return;
    console.log('[WIDGET-DBG] pay', { method, hasShipping: !!get().cart.shipping });

    // Require shipping selection before payment
    if (!cart.shipping) {
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

    // Crypto: pick the chain FIRST, then create the intent in selectCryptoChain.
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

    try {
      // Sync buyer data to checkout session before payment — Asaas requires
      // fullName, email, and cpf on the session to create a customer.
      if (buyer.name || buyer.email || buyer.cpf) {
        await api.updateCustomer({
          customer: {
            fullName: buyer.name,
            email: buyer.email,
            cpf: buyer.cpf,
            phone: buyer.phone,
          },
        }).catch(() => {});
      }

      const intent = await api.createPaymentIntent(method, installments);
      void trackEvent("payment_method_selected", { method, intent_id: intent.intent_id });
      set({
        paymentIntent: intent,
        cart: { ...get().cart, status: "ready_to_pay" },
      });

      // Add payment block as agent message so ChatPanel renders it
      const blockType = method === "pix" ? "pix_payment" : "stripe_card";
      const blockText = method === "pix"
        ? "Pix gerado! Pague e confirmo seu pedido automaticamente."
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
            stripe_client_secret: intent.stripe_client_secret,
            stripe_publishable_key: intent.stripe_publishable_key,
            expires_at_unix: intent.expires_at_unix,
            amount_cents: intent.amount_cents,
          },
        }],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, paymentMsg] }));
    } catch {
      // API failed — show error
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Não foi possível criar o pagamento. Tente novamente.",
        quickReplies: ["Tentar novamente"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
    }
  },

  selectCryptoChain: async (chain) => {
    const { api, buyer } = get();
    if (!api) return;

    try {
      // Sync buyer data before payment (parity with pay()).
      if (buyer.name || buyer.email || buyer.cpf) {
        await api.updateCustomer({
          customer: {
            fullName: buyer.name,
            email: buyer.email,
            cpf: buyer.cpf,
            phone: buyer.phone,
          },
        }).catch(() => {});
      }

      const intent = await api.createPaymentIntent("crypto", undefined, { chain });
      void trackEvent("payment_method_selected", { method: "crypto", intent_id: intent.intent_id, chain });
      set({
        paymentIntent: intent,
        cart: { ...get().cart, status: "ready_to_pay" },
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
            expires_at_unix: intent.expires_at_unix,
            amount_cents: intent.amount_cents,
          },
        }],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, paymentMsg] }));
    } catch {
      const errorMsg: Message = {
        id: `error_${Date.now()}`,
        role: "agent",
        text: "Não foi possível criar o pagamento. Tente novamente.",
        quickReplies: ["Tentar novamente"],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, errorMsg] }));
    }
  },

  pollPayment: () => {
    const { api, paymentIntent } = get();
    // Guard against polling with a missing/empty intent id (would hit /intents/undefined/status)
    if (!api || !paymentIntent || !paymentIntent.intent_id) return;
    set({ paymentPolling: true });

    // Try WebSocket first; on error, fall back to polling
    wsCleanup = connectPaymentWs({
      apiBaseUrl: api.apiBaseUrl,
      token: api.authToken,
      intentId: paymentIntent.intent_id,
      onApproved: () => {
        get().stopPolling();
        void trackEvent("order_completed", {
          intent_id: paymentIntent.intent_id,
        });
        set({
          cart: { ...get().cart, status: "paid" },
          status: "completed",
        });
      },
      onFailed: () => {
        get().stopPolling();
        set({ status: "error", error: "payment_failed" });
      },
      onError: () => {
        // WS failed, fall back to polling
        startPolling();
      },
    });
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
    set({ activeDiscount: { stage, percent, couponCode, message } });
  },

  dismissDiscount: () => {
    set({ activeDiscount: null });
  },

  /**
   * Progressive discount: map checkout cart status → discount stage → percent.
   * Fires the DiscountBanner with increasing percent as the buyer advances.
   * Only activates when merchant has progressiveDiscount.enabled.
   */
  applyProgressiveDiscount: (cartStatus) => {
    const { progressiveDiscount } = get();
    if (!progressiveDiscount?.enabled) return;

    // Map widget cart stages to progressive discount stages
    const stageMap: Record<string, string> = {
      awaiting: "initial_coupon",
      shipping_calculated: "abandoned_cart",
      ready_to_pay: "payment_nudge",
    };

    const discountStage = stageMap[cartStatus];
    if (!discountStage) return;
    const percent = progressiveDiscount.stages[discountStage];
    if (!percent || percent <= 0) return;

    set({ activeDiscount: { stage: discountStage as DiscountStage, percent } });
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
    if (wsCleanup) { wsCleanup(); wsCleanup = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    set({
      status: "loading",
      cart: { items: [], total: 0, discount: 0, status: "awaiting" },
      messages: [],
      paymentIntent: null,
      paymentPolling: false,
      activeDiscount: null,
      error: null,
    });
  },
}));
