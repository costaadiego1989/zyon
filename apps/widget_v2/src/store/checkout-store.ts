import { create } from "zustand";
import {
  CheckoutSession,
  type BrandConfig,
  type AgentConfig,
  type CartItem,
  type ChatBlock,
  type PaymentIntent,
} from "@/api/checkout-session";
import {
  initTracking,
  trackEvent,
  type CheckoutEventName,
} from "@/lib/tracking";
import type { TriggerConfig, TriggerName } from "@/lib/triggers";
import type { AdvancedRule, RuleAction } from "@/lib/advanced-rules";
import { evaluateRules } from "@/lib/advanced-rules";

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
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    city?: string;
    state?: string;
    zipCode?: string;
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
  merchantPaymentConfig: { stripeEnabled?: boolean; cryptoPaymentsEnabled?: boolean; cryptoPayments?: Record<string, unknown> };

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
  activeDiscount: { stage: string; percent: number } | null;
  advancedRules: AdvancedRule[];
  activeRuleActions: RuleAction[];

  // Actions
  init: (params: { embedToken: string; merchantId: string; cartRef?: string; apiBaseUrl: string }) => Promise<void>;
  selectChannel: (channel: "chat" | "voice") => void;
  sendMessage: (text: string) => Promise<void>;
  updateQty: (sku: string, quantity: number) => Promise<void>;
  removeCartItem: (sku: string) => Promise<void>;
  pay: (method: "pix" | "credito" | "debito" | "crypto", installments?: number) => Promise<void>;
  pollPayment: () => void;
  stopPolling: () => void;
  setActiveDiscount: (stage: string, percent: number) => void;
  dismissDiscount: () => void;
  evaluateAdvancedRules: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

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

  init: async ({ embedToken, merchantId, cartRef, apiBaseUrl }) => {
    try {
      const api = new CheckoutSession({ embedToken, merchantId, cartRef, apiBaseUrl });
      set({ api, status: "loading" });

      const response = await api.start();
      const exp = response.experience;

      // Fetch real cart items from storefront cart endpoint (not from embed/start)
      const cartData = await api.fetchCart();
      const items = cartData.items;
      const total = cartData.total || items.reduce((sum, i) => sum + i.price * i.quantity, 0);

      // Buyer data comes pre-resolved from API (via global_user_id in token)
      const buyer: BuyerData = (exp as any)?.buyer ?? {};

      // Flatten brand: API returns brand at top level AND theme nested inside.
      const rawBrand = (exp as any)?.brand ?? {};
      const theme = (rawBrand as any)?.theme ?? {};
      const brand: BrandConfig = {
        name: rawBrand.name ?? theme.name,
        subtitle: (rawBrand as any).subtitle,
        logoUrl: rawBrand.logoUrl ?? theme.logoUrl ?? (rawBrand as any).logo_url,
        accentColor: rawBrand.accentColor ?? theme.accentColor ?? (rawBrand as any).accent_color,
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
      };

      const agent: AgentConfig = {
        name: (exp as any)?.agent?.name ?? theme.agentName ?? (rawBrand as any).agentName,
        greeting: (exp as any)?.agent?.greeting ?? (rawBrand as any).agentGreeting,
      };

      set({
        sessionId: response.session_id,
        brand,
        agent,
        buyer,
        merchantPaymentConfig: {
          stripeEnabled: (exp as any)?.stripeEnabled ?? (rawBrand as any).stripeEnabled ?? true,
          cryptoPaymentsEnabled: (exp as any)?.cryptoPaymentsEnabled ?? (rawBrand as any).cryptoPaymentsEnabled ?? false,
          cryptoPayments: (exp as any)?.cryptoPayments ?? (rawBrand as any).cryptoPayments ?? undefined,
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
        const { buyer, cart } = get();
        const zip = buyer.address?.zipCode || "";

        // Try to fetch real shipping options
        let shippingOptions: Array<{ key: string; label: string; tag: string; sub: string; cost: number }> = [];
        if (zip) {
          try {
            shippingOptions = await api.fetchShippingQuote(zip);
          } catch { /* fallback below */ }
        }
        if (shippingOptions.length === 0) {
          shippingOptions = [
            { key: "pac", label: "Correios PAC", tag: "Econômico", sub: "5-8 dias úteis", cost: 0 },
            { key: "sedex", label: "Correios Sedex", tag: "Rápido", sub: "2-3 dias úteis", cost: 1590 },
            { key: "transportadora", label: "Transportadora", tag: "Econômico", sub: "7-12 dias úteis", cost: 0 },
          ];
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

      // If API returns empty for shipping selection, provide payment methods
      if ((!res.blocks || res.blocks.length === 0) && text.startsWith("Entrega ·")) {
        const { merchantPaymentConfig } = get();
        const methods: Array<{ key: string; label: string; sub: string }> = [];
        methods.push({ key: "pix", label: "Pix", sub: "Pagamento instantâneo, sem taxas" });
        // Stripe always enabled (mandatory in onboarding)
        methods.push({ key: "credito", label: "Cartão de crédito", sub: "Parcele em até 12x sem juros" });
        methods.push({ key: "debito", label: "Cartão de débito", sub: "Débito à vista" });
        if (merchantPaymentConfig.cryptoPaymentsEnabled) {
          const token = (merchantPaymentConfig.cryptoPayments as any)?.token || "USDC";
          const chain = (merchantPaymentConfig.cryptoPayments as any)?.chain || "polygon";
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

      const agentMsg: Message = {
        id: `agent_${Date.now()}`,
        role: "agent",
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
      // API failed — provide local fallback to keep flow going
      const { cart } = get();
      if (text === "Vamos prosseguir" && cart.items.length > 0) {
        // Simulate what API would return: cart summary + shipping options
        const fallbackMsg: Message = {
          id: `agent_${Date.now()}`,
          role: "agent",
          text: `Perfeito! Confirmei seu pedido. Agora escolha como prefere receber:`,
          blocks: [
            { type: "shipping_options", data: { options: [
              { key: "pac", label: "Correios PAC", tag: "Econômico", sub: "5-8 dias úteis", cost: 0 },
              { key: "sedex", label: "Correios Sedex", tag: "Rápido", sub: "2-3 dias úteis", cost: 1590 },
              { key: "transportadora", label: "Transportadora", tag: "Econômico", sub: "7-12 dias úteis", cost: 0 },
            ]}},
          ],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, fallbackMsg], isTyping: false }));
      } else {
        const errorMsg: Message = {
          id: `error_${Date.now()}`,
          role: "agent",
          text: "Não consegui conectar ao servidor. Tente novamente.",
          quickReplies: ["Tentar novamente"],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, errorMsg], isTyping: false }));
      }
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

  pay: async (method, installments) => {
    const { api, messages } = get();
    if (!api) return;
    try {
      const intent = await api.createPaymentIntent(method, installments);
      void trackEvent("payment_method_selected", { method });
      void trackEvent("payment_intent_created", { intent_id: intent.intent_id });
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
    if (!api || !paymentIntent) return;
    set({ paymentPolling: true });

    pollTimer = setInterval(async () => {
      try {
        const status = await api.getPaymentStatus(paymentIntent.intent_id);
        if (status.status === "paid" || status.status === "confirmed") {
          get().stopPolling();
          void trackEvent("payment_confirmed", {
            intent_id: paymentIntent.intent_id,
          });
          set({
            cart: { ...get().cart, status: "paid" },
            status: "completed",
          });
        }
      } catch {
        // continue polling
      }
    }, 3000);
  },

  stopPolling: () => {
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
      buyer: { isReturning: (buyer as any).isReturning, purchaseCount: (buyer as any).purchaseCount },
      session: { stage: "active" },
    };
    const actions = evaluateRules(advancedRules, context);
    set({ activeRuleActions: actions });
  },
}));
