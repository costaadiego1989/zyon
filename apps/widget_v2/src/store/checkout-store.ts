import { create } from "zustand";
import {
  CheckoutSession,
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

  // Payment
  paymentIntent: PaymentIntent | null;
  paymentPolling: boolean;

  // Triggers & Interventions
  triggerConfig: TriggerConfig | null;
  activeDiscount: { stage: DiscountStage; percent: number } | null;
  advancedRules: AdvancedRule[];
  activeRuleActions: RuleAction[];

  // Actions
  init: (params: { embedToken: string; merchantId: string; cartRef?: string; apiBaseUrl: string; globalUserId?: string }) => Promise<void>;
  selectChannel: (channel: "chat" | "voice") => void;
  sendMessage: (text: string) => Promise<void>;
  updateQty: (sku: string, quantity: number) => Promise<void>;
  removeCartItem: (sku: string) => Promise<void>;
  selectShipping: (key: string) => Promise<void>;
  pay: (method: "pix" | "credito" | "debito" | "crypto", installments?: number) => Promise<void>;
  pollPayment: () => void;
  stopPolling: () => void;
  setActiveDiscount: (stage: DiscountStage, percent: number) => void;
  dismissDiscount: () => void;
  evaluateAdvancedRules: () => void;
  resetSession: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsCleanup: (() => void) | null = null;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function startPolling(): void {
  const state = useCheckoutStore.getState();
  const { api, paymentIntent } = state;
  if (!api || !paymentIntent || !paymentIntent.intent_id) return;

  const pollStartTime = Date.now();
  pollTimer = setInterval(async () => {
    if (Date.now() - pollStartTime > MAX_POLL_DURATION_MS) {
      useCheckoutStore.getState().stopPolling();
      useCheckoutStore.setState({ status: "error", error: "payment_expired" });
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
        useCheckoutStore.setState({ status: "error", error: "payment_failed" });
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
  paymentIntent: null,
  paymentPolling: false,
  triggerConfig: null,
  activeDiscount: null,
  advancedRules: [],
  activeRuleActions: [],

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
            },
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
    const { cart } = get();

    const welcomeText = cart.items.length > 0
      ? `Vi que você tem ${cart.items.length} ${cart.items.length === 1 ? 'item' : 'itens'} no carrinho. Vamos finalizar sua compra?`
      : `Olá, estou aqui para te ajudar a encontrar o produto ideal.`;

    set({
      status: "active",
      messages: [
        {
          id: "welcome",
          role: "agent",
          text: welcomeText,
          quickReplies: ["Vamos prosseguir", "Quero voltar"],
          timestamp: Date.now(),
        },
      ],
    });
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

      // Handle address confirmation — user said "Sim"
      if (text === "Sim" && messages.length > 0) {
        const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
        if (lastAgentMsg?.blocks?.some((b) => b.type === "address_confirmation")) {
          // Auto-quote shipping using the confirmed address
          const { buyer } = get();
          const zip = buyer.address?.zip || "00000000";
          let shippingOptions: Array<{ key: string; label: string; tag: string; sub: string; cost: number }> = [];
          try {
            shippingOptions = await api.fetchShippingQuote(zip);
          } catch (err) {
            console.error('[WIDGET-DBG] fetchShippingQuote failed', err);
          }

          if (shippingOptions.length === 0) {
            // Fallback if quote fails
            const zipMsg: Message = {
              id: `agent_${Date.now()}`,
              role: "agent",
              text: "Não consegui calcular o frete. Tente novamente.",
              quickReplies: ["Tentar novamente"],
              timestamp: Date.now(),
            };
            set((s) => ({ messages: [...s.messages, zipMsg], isTyping: false }));
            return;
          }

          const shippingMsg: Message = {
            id: `agent_${Date.now()}`,
            role: "agent",
            text: "Perfeito! Agora escolha como prefere receber:",
            blocks: [{ type: "shipping_options", data: { options: shippingOptions } }],
            timestamp: Date.now(),
          };
          set((s) => ({ messages: [...s.messages, shippingMsg], isTyping: false }));
          return;
        }
      }

      // If API returns empty for shipping selection, provide payment methods
      if ((!res.blocks || res.blocks.length === 0) && text.startsWith("Entrega ·")) {
        const { merchantPaymentConfig } = get();
        const methods: Array<{ key: string; label: string; sub: string }> = [];
        methods.push({ key: "pix", label: "Pix", sub: "Pagamento instantâneo, sem taxas" });
        // Stripe always enabled (mandatory in onboarding)
        methods.push({ key: "credito", label: "Cartão de crédito", sub: "Parcele em até 12x sem juros" });
        methods.push({ key: "debito", label: "Cartão de débito", sub: "Débito à vista" });
        if (merchantPaymentConfig.cryptoPaymentsEnabled) {
          const token = merchantPaymentConfig.cryptoPayments?.token || "USDC";
          const chain = merchantPaymentConfig.cryptoPayments?.chain || "polygon";
          methods.push({ key: "crypto", label: `Crypto · ${token}`, sub: `Liquida na ${chain} + cashback` });
        }

        const payMsg: Message = {
          id: `agent_${Date.now()}`,
          role: "agent",
          text: "Frete selecionado! Agora escolha como quer pagar:",
          blocks: [{ type: "payment_methods", data: { methods } }],
          timestamp: Date.now(),
        };
        set((s) => ({
          messages: [...s.messages, payMsg],
          isTyping: false,
          cart: { ...s.cart, status: "shipping_calculated" },
        }));
        return;
      }

      // Render agent response with message text and blocks
      const agentMsg: Message = {
        id: `agent_${Date.now()}`,
        role: "agent",
        text: res.message,
        blocks: res.blocks,
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
    } catch {
      // API failed — show error message (don't show fake shipping options
      // that have no backend quote, as selectShipping would fail)
      const { cart } = get();
      if (text === "Vamos prosseguir" && cart.items.length > 0) {
        // Try to fetch shipping quote directly even if chat failed
        try {
          const { buyer } = get();
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
      const paymentMsg: Message = {
        id: `agent_pay_${Date.now()}`,
        role: "agent",
        text: method === "pix" ? "Pix gerado! Pague e confirmo seu pedido automaticamente." : "Preencha os dados do cartão para finalizar.",
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

  setActiveDiscount: (stage, percent) => {
    set({ activeDiscount: { stage, percent } });
  },

  dismissDiscount: () => {
    set({ activeDiscount: null });
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
