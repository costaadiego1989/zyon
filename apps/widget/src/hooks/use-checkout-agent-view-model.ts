import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplyOfferResponse,
  Cart,
  ChatMessageResponse,
  ChatTurn,
  CheckoutEventName,
  CheckoutExperienceSnapshot,
  CustomerHints,
  MerchantTheme,
  ShippingQuote,
  StartCheckoutResponse,
  TrackEventResponse
} from "@aacp/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@aacp/shared-types";
import {
  checkoutJson,
  CHECKOUT_EMBED_PATHS,
  CHECKOUT_LEGACY_PATHS,
  normalizeApiBase
} from "../lib/embed-client.js";
import { useAccountHub } from "./use-account-hub.js";
import { useGlobalAuth } from "./use-global-auth.js";
import type { WidgetConfig } from "../lib/widget-types.js";
import {
  buildVisibleCart,
  bubbleKey,
  countVisibleItems,
  filterSuggestedQuickReplies,
  removeVisibleCartItem,
  stageNarrative,
  type QuickReplyChoice,
  type VisibleCartState
} from "./checkout-view-model.js";

const GOOGLE_FONT_WEIGHTS = "400;500;600;700;800";
const GOOGLE_FONT_FAMILIES = new Set([
  "Inter",
  "Manrope",
  "Plus Jakarta Sans",
  "DM Sans",
  "Poppins",
  "Roboto",
  "Sora",
  "Space Grotesk",
  "Montserrat",
  "Outfit",
  "Raleway"
]);

function extractPrimaryFontFamily(fontFamily: string): string {
  return fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, "") || "";
}

function injectGoogleFont(fontFamily: string): void {
  if (typeof document === "undefined") return;
  const family = extractPrimaryFontFamily(fontFamily);
  if (!family || !GOOGLE_FONT_FAMILIES.has(family)) return;
  const id = `aacp-font-${family.toLowerCase().replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(
    /%20/g,
    "+"
  )}:wght@${GOOGLE_FONT_WEIGHTS}&display=swap`;
  document.head.appendChild(link);
}

function fallbackExperience(config: WidgetConfig): CheckoutExperienceSnapshot {
  const shipping = config.shipping?.customerPrice ?? 0;
  const discount = config.cart.currentDiscount ?? 0;
  return {
    brand: {
      merchant_id: config.merchantId,
      name: config.merchantId,
      subtitle: config.copy?.headline ?? "Checkout assistido por IA",
      support_label: "Sincronizando",
      theme: DEFAULT_MERCHANT_THEME
    },
    items: config.cart.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.price,
      line_total: item.price * item.quantity,
      image_url: item.imageUrl,
      product_url: item.productUrl,
      category: item.category,
      variant: item.variant
    })),
    totals: {
      currency: config.cart.currency,
      subtotal: config.cart.total,
      shipping,
      discount,
      total: Math.max(0, config.cart.total + shipping - discount)
    },
    shipping: config.shipping,
    customer: config.customer,
    agent: {
      name: config.agent?.name ?? "Assistente AACP",
      greeting: config.agent?.greeting ?? "Estou conectando com a API da loja para carregar o pedido.",
      tone: (config.agent?.tone as any) ?? "consultative",
      language: config.agent?.language ?? "pt-BR"
    },
    copy: {
      headline: config.copy?.headline ?? "Checkout assistido por IA",
      subheadline: config.copy?.subheadline ?? "Carregando contexto real do pedido.",
      trust_badges: config.copy?.trust_badges ?? ["Sessão será sincronizada pela API"],
      quick_replies: config.copy?.quick_replies ?? ["Olá!", "Quero finalizar agora"],
      expected_input_type: undefined
    },
    rules: { couponBoxEnabled: true }
  };
}

export function useCheckoutAgentViewModel(config: WidgetConfig) {
  const isConversational = config.uiPresentation === "conversational";
  const [session, setSession] = useState<StartCheckoutResponse | null>(null);
  const [open, setOpen] = useState(isConversational);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [lastChat, setLastChat] = useState<ChatMessageResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [experience, setExperience] = useState<CheckoutExperienceSnapshot | null>(null);
  const [resolvedCart, setResolvedCart] = useState<Cart>(config.cart);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [visibleCart, setVisibleCart] = useState<VisibleCartState>(() =>
    buildVisibleCart(fallbackExperience(config))
  );
  const [streamingTurnKey, setStreamingTurnKey] = useState<string | null>(null);
  const [streamingDoneKey, setStreamingDoneKey] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const prevStreamingTurnKey = useRef<string | null>(null);

  const apiOrigin = useMemo(() => normalizeApiBase(config.apiBaseUrl), [config.apiBaseUrl]);
  const productApiOrigin = useMemo(
    () => (config.productApiBaseUrl ? normalizeApiBase(config.productApiBaseUrl) : null),
    [config.productApiBaseUrl]
  );
  const embedOpts = config.mode === "embed" ? { embedToken: config.embedSessionToken! } : {};
  const activeExperience = experience ?? fallbackExperience({ ...config, cart: resolvedCart });
  const visibleItems = visibleCart.items;
  const visibleTotals = visibleCart.totals;
  const cartItemCount = countVisibleItems(visibleItems);
  const theme: MerchantTheme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const offer = lastChat?.authorized_offer;

  const checkoutStage = useMemo(() => {
    const apiStage = lastChat?.stage ?? activeExperience.stage;
    if (apiStage) return apiStage;
    return "data_collection";
  }, [activeExperience.stage, lastChat?.stage]);

  const nextMissingField = lastChat?.missing_fields?.[0];
  const stageNote = stageNarrative(checkoutStage, nextMissingField);
  const awaitingAgentPlayback =
    streamingTurnKey !== null && streamingDoneKey !== streamingTurnKey;
  const composerLocked = busy || Boolean(networkError) || awaitingAgentPlayback;
  const showComposer = isConversational && Boolean(session) && !networkError && checkoutStage !== "completed";
  const showCouponBox =
    checkoutStage === "payment" &&
    activeExperience.rules?.couponBoxEnabled !== false &&
    visibleTotals.discount === 0;
  const showOfferBanner = visibleTotals.discount > 0;
  const chatTrustBadges = activeExperience.copy.trust_badges.slice(0, 3);

  const auth = useGlobalAuth({
    apiBaseUrl: apiOrigin,
    defaultMerchantName: activeExperience.brand.name,
    defaultEmail: config.customer?.email
  });
  const hub = useAccountHub({
    apiBaseUrl: apiOrigin,
    session: auth.session,
    enabled: auth.open && auth.panel === "hub" && Boolean(auth.session)
  });

  const quickReplies: QuickReplyChoice[] = useMemo(() => {
    if (!isConversational || turns.length < 1 || busy) return [];

    const list: QuickReplyChoice[] = [];

    if (lastChat?.actions && lastChat.actions.length > 0) {
      list.push(
        ...lastChat.actions.map((action) => ({
          label: action.label,
          type: action.type as any,
          offerId: action.offer_id
        }))
      );
    }

    if (activeExperience.stage === "data_collection" && (!lastChat || turns.length <= 2)) {
      list.push(
        { label: "Olá!" },
        { label: "Quero começar" },
        { label: "Quero finalizar agora" }
      );
    }

    if (activeExperience.copy.quick_replies.length > 0) {
      list.push(
        ...filterSuggestedQuickReplies(
          activeExperience.copy.quick_replies.map((label) => ({ label })),
          checkoutStage
        )
      );
    }

    const uniqueList: QuickReplyChoice[] = [];
    const seenLabels = new Set<string>();
    for (const item of list) {
      const labelTrimmed = (item.label ?? "").trim();
      if (labelTrimmed && !seenLabels.has(labelTrimmed)) {
        seenLabels.add(labelTrimmed);
        uniqueList.push(item);
      }
    }

    return uniqueList;
  }, [activeExperience.copy.quick_replies, checkoutStage, isConversational, lastChat?.actions, busy, turns.length, activeExperience.stage]);

  useEffect(() => {
    if (streamingTurnKey == null) return;
    if (prevStreamingTurnKey.current === streamingTurnKey) return;
    prevStreamingTurnKey.current = streamingTurnKey;
    setStreamingDoneKey(null);
  }, [streamingTurnKey]);

  useEffect(() => {
    injectGoogleFont(theme.fontFamily);
  }, [theme.fontFamily]);

  useEffect(() => {
    void startCheckout();
    const idleTimer = window.setTimeout(() => {
      void track("idle_30_seconds");
    }, 30_000);
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ event: CheckoutEventName }>;
      if (custom.detail?.event) void track(custom.detail.event);
    };
    window.addEventListener("aacp:checkout-event", listener);
    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener("aacp:checkout-event", listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isConversational && session && turns.length === 1 && !config.customer?.fullName && !busy && !networkError) {
      const timer = setTimeout(() => {
        void autoTriggerRegistration();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [session, turns.length, isConversational, busy, networkError, config.customer?.fullName]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns.length, busy, streamingTurnKey, streamingDoneKey]);

  useEffect(() => {
    if (!showComposer) return;
    composerInputRef.current?.focus();
  }, [showComposer]);

  function appendAgentTurn(text: string, opts: { stream?: boolean } = {}): void {
    const turn: ChatTurn = {
      role: "agent",
      text,
      occurredAt: new Date().toISOString()
    };
    setTurns((current) => {
      const next = [...current, turn];
      if (opts.stream) setStreamingTurnKey(bubbleKey(turn, next.length - 1));
      return next;
    });
  }

  function syncExperience(nextExperience: CheckoutExperienceSnapshot): void {
    setExperience(nextExperience);
    setVisibleCart(buildVisibleCart(nextExperience));
    setNetworkError(null);
  }

  async function resolveCheckoutCart(): Promise<Cart> {
    if (!productApiOrigin || !config.productSelection?.length) return config.cart;

    const response = await fetch(`${productApiOrigin}/checkout-cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: config.productSelection })
    });

    if (!response.ok) {
      throw new Error(`Product cart request failed: ${response.status}`);
    }

    const payload = (await response.json()) as { cart?: Cart };
    if (!payload.cart) throw new Error("Product cart response missing cart");

    setResolvedCart(payload.cart);
    setVisibleCart(buildVisibleCart(fallbackExperience({ ...config, cart: payload.cart })));
    return payload.cart;
  }

  async function startCheckout() {
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    try {
      const savedSessionId = window.localStorage.getItem("aacp_session_id");
      const cart = await resolveCheckoutCart();
      const body =
        config.mode === "embed"
          ? { customer: config.customer, cart, shipping: config.shipping, session_id: savedSessionId || undefined }
          : {
            merchant_id: config.merchantId,
            customer: config.customer,
            cart,
            shipping: config.shipping,
            session_id: savedSessionId || undefined
          };
      const response = await checkoutJson<StartCheckoutResponse>(apiOrigin, paths.start, {
        ...embedOpts,
        body
      });

      setSession(response);
      syncExperience(response.experience);

      if (Array.isArray(response.turns) && response.turns.length > 0) {
        setTurns(response.turns);
        const lastAgentIdx = response.turns.map(t => t.role).lastIndexOf("agent");
        if (lastAgentIdx >= 0) {
          setStreamingTurnKey(bubbleKey(response.turns[lastAgentIdx]!, lastAgentIdx));
        }
      } else {
        const greeting: ChatTurn = {
          role: "agent",
          text: response.experience.agent.greeting,
          occurredAt: new Date().toISOString()
        };
        setTurns([greeting]);
        setStreamingTurnKey(bubbleKey(greeting, 0));

        // After 1.5 seconds, append friendly registration prompt
        setTimeout(() => {
          const registrationTurn: ChatTurn = {
            role: "agent",
            text: "Antes de começar, preciso fazer o seu cadastro. Qual é o seu nome completo?",
            occurredAt: new Date().toISOString()
          };
          setTurns((curr) => {
            if (curr.length === 1 && curr[0].text === greeting.text) {
              setStreamingTurnKey(bubbleKey(registrationTurn, 1));
              return [...curr, registrationTurn];
            }
            return curr;
          });
        }, 1500);
      }

      if (response.initial_mode === "open") setOpen(true);
      window.localStorage.setItem("aacp_global_user_id", response.global_user_id);
      window.localStorage.setItem("aacp_session_id", response.session_id);
    } catch {
      setNetworkError(
        productApiOrigin && config.productSelection?.length
          ? "Não consegui carregar os produtos ou sincronizar esta sessão com a API agora. A conversa ficará bloqueada até a conexão voltar."
          : "Não consegui sincronizar esta sessão com a API agora. A conversa ficará bloqueada até a conexão voltar."
      );
      const fallbackTurn: ChatTurn = {
        role: "agent",
        text: "Estou tentando conectar com a API da loja para carregar seu pedido real.",
        occurredAt: new Date().toISOString()
      };
      setTurns([fallbackTurn]);
      setStreamingTurnKey(bubbleKey(fallbackTurn, 0));
    }
  }

  async function track(event: CheckoutEventName) {
    if (!session) return;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body =
      config.mode === "embed"
        ? { session_id: session.session_id, event }
        : { merchant_id: config.merchantId, session_id: session.session_id, event };

    const response = await checkoutJson<TrackEventResponse>(apiOrigin, paths.track, {
      ...embedOpts,
      body
    });
    if (response.trigger_agent) {
      setOpen(true);
      if (!isConversational) {
        appendAgentTurn(
          "Vi que talvez exista alguma duvida no checkout. Posso tentar uma condicao melhor para voce finalizar agora?",
          { stream: true }
        );
      }
    }
  }

  function handleAgentTypingDone(key: string): void {
    if (streamingTurnKey === key) setStreamingDoneKey(key);
  }

  async function tapQuick(reply: QuickReplyChoice): Promise<void> {
    if (!session || networkError || composerLocked) return;
    if (reply.event) void track(reply.event);
    if (reply.type === "apply_offer") {
      await applyOfferById(reply.offerId);
      return;
    }
    await sendMessageWithOverride(reply.label);
  }

  async function autoTriggerRegistration(): Promise<void> {
    if (!session || networkError || composerLocked) return;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body =
        config.mode === "embed"
          ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Iniciar cadastro" }
          : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Iniciar cadastro" };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, { ...embedOpts, body });
      setLastChat(response);
      if (response.experience) syncExperience(response.experience);
      if (Array.isArray(response.turns) && response.turns.length > 0) {
        setTurns(response.turns);
        let foundAgentIdx = -1;
        for (let i = response.turns.length - 1; i >= 0; i--) {
          if (response.turns[i]!.role === "agent") { foundAgentIdx = i; break; }
        }
        if (foundAgentIdx >= 0) setStreamingTurnKey(bubbleKey(response.turns[foundAgentIdx]!, foundAgentIdx));
      } else {
        appendAgentTurn(response.message, { stream: true });
      }
    } catch {
      setNetworkError("Falha ao falar com a IA. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessageWithOverride(userText: string): Promise<void> {
    if (!session || networkError || !userText.trim() || composerLocked) return;
    setBusy(true);
    const optimisticTurn: ChatTurn = {
      role: "buyer",
      text: userText.trim(),
      occurredAt: new Date().toISOString()
    };
    setTurns((current) => [...current, optimisticTurn]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body =
        config.mode === "embed"
          ? {
            session_id: session.session_id,
            conversation_id: session.conversation_id,
            user_message: userText.trim()
          }
          : {
            merchant_id: config.merchantId,
            session_id: session.session_id,
            conversation_id: session.conversation_id,
            user_message: userText.trim()
          };

      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, {
        ...embedOpts,
        body
      });
      setLastChat(response);
      if (response.experience) syncExperience(response.experience);

      if (Array.isArray(response.turns) && response.turns.length > 0) {
        setTurns(response.turns);
        let foundAgentIdx = -1;
        for (let i = response.turns.length - 1; i >= 0; i--) {
          if (response.turns[i]!.role === "agent") {
            foundAgentIdx = i;
            break;
          }
        }
        if (foundAgentIdx >= 0) {
          setStreamingTurnKey(bubbleKey(response.turns[foundAgentIdx]!, foundAgentIdx));
        }
      } else {
        appendAgentTurn(response.message, { stream: true });
      }
      setMessage("");
    } catch {
      setNetworkError("Falha ao falar com a IA. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    const userText = message.trim();
    if (!session || !userText) return;
    setMessage("");
    await sendMessageWithOverride(userText);
  }

  async function applyOfferById(offerId?: string) {
    if (!session) return;
    const targetOffer =
      offerId && lastChat?.authorized_offer?.id === offerId
        ? lastChat.authorized_offer
        : lastChat?.authorized_offer;
    if (!targetOffer) return;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body =
        config.mode === "embed"
          ? { session_id: session.session_id, offer_id: targetOffer.id }
          : {
            merchant_id: config.merchantId,
            session_id: session.session_id,
            offer_id: targetOffer.id
          };

      const response = await checkoutJson<ApplyOfferResponse>(apiOrigin, paths.applyOffer, {
        ...embedOpts,
        body
      });
      if (response.experience) syncExperience(response.experience);
      if (response.agent_turn) {
        setTurns((current) => {
          const next = [...current, response.agent_turn as ChatTurn];
          setStreamingTurnKey(bubbleKey(next[next.length - 1]!, next.length - 1));
          return next;
        });
      } else {
        appendAgentTurn(
          response.success
            ? `Oferta aplicada. Codigo: ${response.discount_code ?? "gerado"}.`
            : `Não consegui aplicar a oferta: ${response.reason ?? "erro desconhecido"}.`,
          { stream: true }
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyOffer(): Promise<void> {
    await applyOfferById(lastChat?.authorized_offer?.id);
  }

  async function continueToPayment(): Promise<void> {
    await sendMessageWithOverride("Quero seguir para o pagamento.");
  }

  async function submitCoupon(): Promise<void> {
    const code = coupon.trim();
    if (!code) return;
    setCoupon("");
    await sendMessageWithOverride(`Tenho o cupom: ${code}`);
  }

  function handleRemoveCartItem(sku: string): void {
    setVisibleCart((current) => removeVisibleCartItem(current, sku));
  }

  async function createEmbedPaymentIntentDemo() {
    if (!session || config.mode !== "embed") return;
    setBusy(true);
    try {
      type EmbedPaySnapshot = {
        amountCents?: number;
        currency?: string;
        buyerFacing?: { invoiceUrl?: string; qrCodeCopyPaste?: string };
      };

      const offerNow = lastChat?.authorized_offer;
      const body = {
        session_id: session.session_id,
        idempotency_key: crypto.randomUUID(),
        method: "pix" as const,
        ...(offerNow?.approved && offerNow.id ? { accepted_offer_id: offerNow.id } : {})
      };

      const snap = await checkoutJson<EmbedPaySnapshot>(
        apiOrigin,
        CHECKOUT_EMBED_PATHS.paymentIntents,
        { ...embedOpts, body }
      );

      const total =
        typeof snap.amountCents === "number"
          ? `${(snap.amountCents / 100).toFixed(2)} ${snap.currency ?? ""}`.trim()
          : "";

      const bf = snap.buyerFacing;
      const pixLine =
        bf?.invoiceUrl != null && bf.invoiceUrl.length > 0
          ? ` Fatura/link: ${bf.invoiceUrl}.`
          : bf?.qrCodeCopyPaste != null && bf.qrCodeCopyPaste.length > 0
            ? ` Copia e cola PIX: ${bf.qrCodeCopyPaste.slice(0, 80)}${bf.qrCodeCopyPaste.length > 80 ? "..." : ""
            }.`
            : "";

      appendAgentTurn(total.length > 0 ? `Cobrança gerada (${total}).${pixLine}` : `Cobrança criada.${pixLine}`, {
        stream: true
      });
    } catch {
      appendAgentTurn(
        "Não foi possível gerar a cobrança. Verifique o token embed e os dados do pagador na API.",
        { stream: true }
      );
    } finally {
      setBusy(false);
    }
  }

  function retryStartCheckout(): void {
    setNetworkError(null);
    setTurns([]);
    void startCheckout();
  }

  return {
    config,
    isConversational,
    session,
    open,
    setOpen,
    turns,
    message,
    setMessage,
    lastChat,
    busy,
    activeExperience,
    networkError,
    retryStartCheckout,
    cartOpen,
    setCartOpen,
    visibleItems,
    visibleTotals,
    cartItemCount,
    streamingTurnKey,
    handleAgentTypingDone,
    coupon,
    setCoupon,
    threadRef,
    composerInputRef,
    theme,
    offer,
    checkoutStage,
    stageNote,
    showComposer,
    composerLocked,
    showCouponBox,
    showOfferBanner,
    chatTrustBadges,
    quickReplies,
    auth,
    hub,
    tapQuick,
    sendMessage,
    applyOffer,
    continueToPayment,
    submitCoupon,
    handleRemoveCartItem,
    createEmbedPaymentIntentDemo,
    colorMode,
    toggleColorMode: () => setColorMode((m) => m === "light" ? "dark" : "light")
  };
}

export type CheckoutAgentViewModel = ReturnType<typeof useCheckoutAgentViewModel>;
export type { Cart, CustomerHints, ShippingQuote };
