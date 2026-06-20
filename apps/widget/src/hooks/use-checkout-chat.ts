import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  ApplyOfferResponse,
  ChatMessageResponse,
  ChatTurn,
  SuggestedProduct
} from "@aacp/shared-types";
import {
  checkoutGet,
  checkoutJson,
  CHECKOUT_EMBED_PATHS,
  CHECKOUT_LEGACY_PATHS
} from "../lib/embed-client.js";
import {
  applyCouponResponseSchema,
  applyOfferResponseSchema,
  catalogAddResponseSchema,
  catalogSearchResponseSchema,
  chatMessageResponseSchema,
  crossSellAcceptResponseSchema
} from "../lib/widget-schemas.js";
import type { WidgetConfig } from "../lib/widget-types.js";
import { bubbleKey, shouldBootstrapShippingSelection, shouldSkipAutoRegistration, type QuickReplyChoice } from "./checkout-presentation.js";
import { disableStreamingByEnv } from "./use-streamed-text.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";
import type { PurchaseChannel } from "./use-checkout-panels.js";

const DEFAULT_QUICK_REPLIES: QuickReplyChoice[] = [
  { label: "Olá!" },
  { label: "Quero começar" },
  { label: "Quero finalizar agora" },
];

type CheckoutChatOptions = {
  purchaseChannel?: PurchaseChannel;
};

function applyCheckoutStartTurns(
  response: NonNullable<CheckoutSessionState["startedEvent"]>["response"],
  setTurns: Dispatch<SetStateAction<ChatTurn[]>>,
  setStreamingTurnKey: Dispatch<SetStateAction<string | null>>
): void {
  if (Array.isArray(response.turns) && response.turns.length > 0) {
    setTurns(response.turns);
    const lastAgentIdx = response.turns.map((t) => t.role).lastIndexOf("agent");
    if (lastAgentIdx >= 0) {
      setStreamingTurnKey(bubbleKey(response.turns[lastAgentIdx]!, lastAgentIdx));
    }
    return;
  }
  const greeting: ChatTurn = {
    role: "agent",
    text: response.experience.agent.greeting,
    occurredAt: new Date().toISOString()
  };
  setTurns([greeting]);
  setStreamingTurnKey(bubbleKey(greeting, 0));
}

export function useCheckoutChat(
  config: WidgetConfig,
  sessionState: CheckoutSessionState,
  options: CheckoutChatOptions = {}
) {
  const { session, activeExperience, syncExperience, networkError, apiOrigin, embedOpts } = sessionState;
  const isConversational = config.uiPresentation === "conversational";
  const purchaseChannel = options.purchaseChannel ?? "chat";
  const channelReady = !isConversational || purchaseChannel !== "pending";

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [lastChat, setLastChat] = useState<ChatMessageResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [streamingTurnKey, setStreamingTurnKey] = useState<string | null>(null);
  const [streamingDoneKey, setStreamingDoneKey] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const prevStreamingTurnKey = useRef<string | null>(null);
  const prevStartTs = useRef(0);
  const registrationBootstrapped = useRef<string | null>(null);
  const shippingBootstrapped = useRef<string | null>(null);
  const pendingStartEvent = useRef<NonNullable<CheckoutSessionState["startedEvent"]> | null>(null);
  const [catalogResults, setCatalogResults] = useState<SuggestedProduct[]>([]);

  const isCartEmpty = activeExperience.items.length === 0;

  const checkoutStage = useMemo(() => {
    if (activeExperience.stage === "completed") return "completed";
    const apiStage = lastChat?.stage ?? activeExperience.stage;
    return apiStage ?? "data_collection";
  }, [activeExperience.stage, lastChat?.stage]);

  const awaitingAgentPlayback = !disableStreamingByEnv() && streamingTurnKey !== null && streamingDoneKey !== streamingTurnKey;
  const composerLocked = busy || Boolean(networkError);

  const quickReplies = useMemo((): QuickReplyChoice[] => {
    if (!isConversational || turns.length < 1 || busy) return [];
    if (isCartEmpty) return [];
    const list: QuickReplyChoice[] = [];

    if (!lastChat) {
      // Greeting quick replies belong to the opening only. Some buyer
      // interactions advance the conversation through syncExperience without
      // setting lastChat (catalog search/add, coupon, cross-sell accept, apply
      // offer), which previously left lastChat null and re-injected the
      // greeting chips. Only show them while the buyer hasn't interacted yet
      // and the experience is still at the opening stage.
      const hasInteracted =
        turns.some((turn) => turn.role === "buyer") || checkoutStage !== "data_collection";
      if (!hasInteracted) {
        list.push(...DEFAULT_QUICK_REPLIES);
      }
      if (activeExperience.copy.quick_replies.length > 0) {
        list.push(...activeExperience.copy.quick_replies.map((label) => ({ label })));
      }
    } else {
      if (lastChat.actions?.length) {
        const actions = lastChat.actions.filter((a) => checkoutStage === "payment" || a.type === "show_alternatives");
        list.push(...actions.map((a) => ({ label: a.label, type: a.type as never, offerId: a.offer_id })));
      }

      if (activeExperience.copy.quick_replies.length > 0) {
        list.push(...activeExperience.copy.quick_replies.map((label) => ({ label })));
      }

      if (checkoutStage === "payment" && lastChat.authorized_offer?.approved && !list.some((r) => /desconto/i.test(r.label ?? ""))) {
        const offer = lastChat.authorized_offer;
        const pct = offer.type === "discount_percent" ? offer.value : 0;
        if (pct > 0 && offer.id) {
          list.push({ label: `Aplicar desconto de ${pct}%`, offerId: offer.id });
        }
      }
    }

    const seen = new Set<string>();
    return list.filter((r) => {
      const key = (r.label ?? "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeExperience.copy.quick_replies, checkoutStage, isCartEmpty, isConversational, lastChat, busy, turns.length]);

  useEffect(() => {
    if (streamingTurnKey == null) return;
    if (prevStreamingTurnKey.current === streamingTurnKey) return;
    prevStreamingTurnKey.current = streamingTurnKey;
    setStreamingDoneKey(null);
  }, [streamingTurnKey]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    scrollToBottom();
    window.requestAnimationFrame?.(scrollToBottom);
  }, [
    turns.length,
    busy,
    streamingTurnKey,
    streamingDoneKey,
    awaitingAgentPlayback,
    quickReplies.length,
    checkoutStage,
  ]);

  useEffect(() => {
    if (
      !isConversational ||
      !session ||
      networkError ||
      checkoutStage === "completed" ||
      checkoutStage === "payment" ||
      awaitingAgentPlayback
    ) {
      return;
    }
    const raf = window.requestAnimationFrame(() => {
      composerInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    awaitingAgentPlayback,
    isConversational,
    session,
    networkError,
    checkoutStage,
    turns.length,
  ]);

  useEffect(() => {
    const ev = sessionState.startedEvent;
    if (!ev || ev.ts === prevStartTs.current) return;
    prevStartTs.current = ev.ts;

    if (!channelReady) {
      pendingStartEvent.current = ev;
      return;
    }

    applyCheckoutStartTurns(ev.response, setTurns, setStreamingTurnKey);
  }, [sessionState.startedEvent, channelReady]);

  useEffect(() => {
    if (!channelReady) return;
    const ev = pendingStartEvent.current;
    if (!ev) return;
    pendingStartEvent.current = null;
    applyCheckoutStartTurns(ev.response, setTurns, setStreamingTurnKey);
  }, [channelReady]);

  useEffect(() => {
    if (!channelReady) return;
    if (!sessionState.startErrorTs) return;
    const fallbackTurn: ChatTurn = {
      role: "agent",
      text: "Estou tentando conectar com a API da loja para carregar seu pedido real.",
      occurredAt: new Date().toISOString()
    };
    setTurns([fallbackTurn]);
    setStreamingTurnKey(bubbleKey(fallbackTurn, 0));
  }, [sessionState.startErrorTs, channelReady]);

  useEffect(() => {
    if (!channelReady) return;
    const sessionId = session?.session_id;
    if (!sessionId || !isConversational || isCartEmpty || networkError || busy) return;
    if (purchaseChannel === "voice") return;

    const customer = activeExperience.customer ?? config.customer;
    const stage = lastChat?.stage ?? activeExperience.stage;

    if (shouldBootstrapShippingSelection(customer, stage) && !lastChat) {
      if (shippingBootstrapped.current === sessionId) return;
      const timer = setTimeout(() => {
        void runShippingBootstrap(sessionId);
      }, 800);
      return () => clearTimeout(timer);
    }

    if (registrationBootstrapped.current === sessionId) return;
    if (shouldSkipAutoRegistration(customer)) return;

    const timer = setTimeout(() => {
      void runRegistrationBootstrap(sessionId, customer);
    }, 800);
    return () => clearTimeout(timer);
  }, [
    activeExperience.customer,
      activeExperience.stage,
      busy,
      config.customer,
      isCartEmpty,
      isConversational,
      lastChat,
      networkError,
      purchaseChannel,
      session,
      session?.session_id,
      channelReady
    ]);

  async function runShippingBootstrap(sessionId: string): Promise<void> {
    if (shippingBootstrapped.current === sessionId) return;
    if (!session || networkError || busy) return;
    setBusy(true);
    setTurns((current) => [
      ...current,
      { role: "buyer", text: "Quero escolher o frete", occurredAt: new Date().toISOString() }
    ]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Quero escolher o frete" }
        : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Quero escolher o frete" };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, {
        ...embedOpts,
        body,
        schema: chatMessageResponseSchema
      });
      applyTurnResponse(response);
      shippingBootstrapped.current = sessionId;
      registrationBootstrapped.current = sessionId;
    } catch {
      sessionState.setNetworkError?.("Falha ao carregar opções de frete. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function runRegistrationBootstrap(
    sessionId: string,
    customer: typeof activeExperience.customer
  ): Promise<void> {
    if (registrationBootstrapped.current === sessionId) return;
    if (!session || networkError || busy) return;

    const email = customer?.email?.trim();
    const started =
      email && !customer?.email_verified
        ? await bootstrapCustomerEmail(email)
        : await autoTriggerRegistration();
    if (started) registrationBootstrapped.current = sessionId;
  }

  function appendAgentTurn(text: string, opts: { stream?: boolean } = {}): void {
    const turn: ChatTurn = { role: "agent", text, occurredAt: new Date().toISOString() };
    setTurns((current) => {
      const next = [...current, turn];
      if (opts.stream) setStreamingTurnKey(bubbleKey(turn, next.length - 1));
      return next;
    });
  }

  function handleAgentTypingDone(key: string): void {
    if (streamingTurnKey === key) setStreamingDoneKey(key);
  }

  function applyTurnResponse(response: ChatMessageResponse): void {
    sessionState.setNetworkError?.(null);
    setLastChat(response);
    if (response.experience) syncExperience(response.experience);
    if (Array.isArray(response.turns) && response.turns.length > 0) {
      setTurns(response.turns);
      for (let i = response.turns.length - 1; i >= 0; i--) {
        if (response.turns[i]!.role === "agent") {
          setStreamingTurnKey(bubbleKey(response.turns[i]!, i));
          break;
        }
      }
    } else {
      appendAgentTurn(response.message, { stream: true });
    }
  }

  useEffect(() => {
    if (!isCartEmpty) setCatalogResults([]);
  }, [isCartEmpty]);

  async function searchCatalog(query: string): Promise<void> {
    if (!session || networkError || composerLocked) return;
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: query, occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const response = await checkoutGet<{ products: SuggestedProduct[] }>(
        apiOrigin,
        `${paths.catalogSearch}?q=${encodeURIComponent(query)}&limit=8`,
        { ...embedOpts, schema: catalogSearchResponseSchema }
      );
      setCatalogResults(response.products ?? []);
      const count = response.products?.length ?? 0;
      appendAgentTurn(
        count > 0
          ? `Encontrei ${count} opção(ões) na loja para "${query}". Escolha uma para adicionar ao carrinho.`
          : `Não encontrei produtos para "${query}". Tente outro termo, como bolsa ou carteira.`,
        { stream: true }
      );
    } catch {
      sessionState.setNetworkError?.("Falha ao buscar produtos na loja. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function addCatalogProduct(product: SuggestedProduct): Promise<boolean> {
    if (!session || networkError || composerLocked) return false;
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: `Adicionar ${product.name}`, occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const response = await checkoutJson<{ experience?: typeof activeExperience; agent_turn?: ChatTurn }>(
        apiOrigin,
        paths.catalogAdd,
        {
          ...embedOpts,
          body: { session_id: session.session_id, sku: product.sku, quantity: 1 },
          schema: catalogAddResponseSchema
        }
      );
      if (response.experience) syncExperience(response.experience);
      setCatalogResults([]);
      if (response.agent_turn) {
        setTurns((current) => {
          const next = [...current, response.agent_turn as ChatTurn];
          setStreamingTurnKey(bubbleKey(next[next.length - 1]!, next.length - 1));
          return next;
        });
      } else {
        appendAgentTurn(`${product.name} adicionado ao seu pedido.`, { stream: true });
      }
      return true;
    } catch {
      sessionState.setNetworkError?.("Falha ao adicionar o produto. Tente novamente em instantes.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendMessageWithOverride(userText: string): Promise<void> {
    if (!session || networkError || !userText.trim() || composerLocked) return;
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: userText.trim(), occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: userText.trim() }
        : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: userText.trim() };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, {
        ...embedOpts,
        body,
        schema: chatMessageResponseSchema
      });
      applyTurnResponse(response);
      setMessage("");
    } catch {
      sessionState.setNetworkError?.("Falha ao falar com a IA. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(): Promise<void> {
    const userText = message.trim();
    if (!session || !userText) return;
    setMessage("");
    if (isCartEmpty) {
      await searchCatalog(userText);
      return;
    }
    await sendMessageWithOverride(userText);
  }

  async function autoTriggerRegistration(): Promise<boolean> {
    if (!session || networkError || composerLocked) return false;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Iniciar cadastro" }
        : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Iniciar cadastro" };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, {
        ...embedOpts,
        body,
        schema: chatMessageResponseSchema
      });
      applyTurnResponse(response);
      return true;
    } catch {
      sessionState.setNetworkError?.("Falha ao falar com a IA. Tente novamente em instantes.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function bootstrapCustomerEmail(email: string): Promise<boolean> {
    if (!session || networkError || composerLocked) return false;
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: email, occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: email }
        : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: email };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, {
        ...embedOpts,
        body,
        schema: chatMessageResponseSchema
      });
      applyTurnResponse(response);
      return true;
    } catch {
      sessionState.setNetworkError?.("Falha ao iniciar o cadastro. Tente novamente em instantes.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function applyOfferById(offerId?: string): Promise<void> {
    if (!session) return;
    // P3: the previous ternary resolved to lastChat.authorized_offer on BOTH
    // branches, so an offerId that didn't match was silently applied anyway.
    // Now we validate and abort if the id doesn't match the current authorized
    // offer — discounts are only applied as returned by the API, never client-picked.
    const currentOffer = lastChat?.authorized_offer;
    if (!currentOffer) return;
    if (offerId && currentOffer.id !== offerId) {
      // offerId requested is not the currently authorized offer — refuse silently
      // rather than applying the wrong discount.
      return;
    }
    const targetOffer = currentOffer;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, offer_id: targetOffer.id }
        : { merchant_id: config.merchantId, session_id: session.session_id, offer_id: targetOffer.id };
      const response = await checkoutJson<ApplyOfferResponse>(apiOrigin, paths.applyOffer, {
        ...embedOpts,
        body,
        schema: applyOfferResponseSchema
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

  async function tapQuick(reply: QuickReplyChoice): Promise<void> {
    if (!session || networkError || composerLocked) return;
    if (reply.event) void sessionState.track(reply.event);
    if (reply.type === "apply_offer") {
      await applyOfferById(reply.offerId);
      return;
    }
    await sendMessageWithOverride(reply.label);
  }

  async function continueToPayment(): Promise<void> {
    await sendMessageWithOverride("Quero seguir para o pagamento.");
  }

  async function acceptCrossSell(product: SuggestedProduct): Promise<boolean> {
    if (!session || networkError || composerLocked || !product.suggestion_id) return false;
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: `Adicionar ${product.name}`, occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const response = await checkoutJson<{
        suggestion: unknown;
        experience?: typeof activeExperience;
        agent_turn?: ChatTurn;
      }>(
        apiOrigin,
        paths.acceptCrossSell,
        {
          ...embedOpts,
          body: {
            session_id: session.session_id,
            suggestion_id: product.suggestion_id,
            accepted_skus: [product.sku]
          },
          schema: crossSellAcceptResponseSchema
        }
      );
      if (response.experience) syncExperience(response.experience);
      if (response.agent_turn) {
        setTurns((current) => {
          const next = [...current, response.agent_turn as ChatTurn];
          setStreamingTurnKey(bubbleKey(next[next.length - 1]!, next.length - 1));
          return next;
        });
      } else {
        appendAgentTurn(`${product.name} adicionado ao seu pedido.`, { stream: true });
      }
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitCoupon(): Promise<boolean> {
    const code = coupon.trim();
    if (!code || !session) return false;
    setCoupon("");
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: `Cupom: ${code}`, occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body: Record<string, unknown> = {
        session_id: session.session_id,
        merchant_id: config.merchantId,
        code,
        cart: {
          currency: activeExperience.totals.currency,
          total: activeExperience.totals.subtotal,
          currentDiscount: activeExperience.totals.discount,
          items: activeExperience.items.map((item) => ({
            sku: item.sku,
            name: item.name,
            price: item.unit_price,
            quantity: item.quantity,
            category: item.category,
            variant: item.variant,
            imageUrl: item.image_url,
            productUrl: item.product_url
          }))
        }
      };
      const response = await checkoutJson<{ redemption_id: string; discount_applied: number; coupon: unknown; experience?: typeof activeExperience }>(
        apiOrigin,
        paths.applyCoupon,
        { ...embedOpts, body, schema: applyCouponResponseSchema }
      );
      if (response.experience) syncExperience(response.experience);
      appendAgentTurn(
        `Cupom ${code.toUpperCase()} aplicado! Desconto de R$${response.discount_applied.toFixed(2)}.`,
        { stream: true }
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      let userMsg = "Cupom inválido. Verifique o código e tente novamente.";
      if (msg.includes("404") || msg.includes("COUPON_NOT_FOUND")) {
        userMsg = "Cupom não encontrado. Verifique o código e tente novamente.";
      } else if (msg.includes("409") || msg.includes("COUPON_ALREADY_APPLIED")) {
        userMsg = "Este cupom já foi aplicado nesta sessão.";
      } else if (msg.includes("400")) {
        userMsg = "Cupom inválido ou expirado. Verifique e tente novamente.";
      }
      appendAgentTurn(userMsg, { stream: true });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function resetAfterCompletion(): void {
    setCatalogResults([]);
    setCoupon("");
    setMessage("");
    setLastChat(null);
  }

  function retryChat(): void {
    sessionState.retryStartCheckout();
    setTurns([]);
    setLastChat(null);
  }

  return {
    turns,
    message,
    setMessage,
    lastChat,
    busy,
    coupon,
    setCoupon,
    streamingTurnKey,
    threadRef,
    composerInputRef,
    checkoutStage,
    composerLocked,
    awaitingAgentPlayback,
    quickReplies,
    catalogResults,
    isCartEmpty,
    appendAgentTurn,
    handleAgentTypingDone,
    sendMessage,
    sendMessageWithOverride,
    searchCatalog,
    addCatalogProduct,
    tapQuick,
    applyOffer: () => applyOfferById(lastChat?.authorized_offer?.id),
    continueToPayment,
    acceptCrossSell,
    submitCoupon,
    retryChat,
    resetAfterCompletion,
  };
}

export type CheckoutChatState = ReturnType<typeof useCheckoutChat>;
