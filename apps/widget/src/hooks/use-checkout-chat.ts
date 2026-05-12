import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplyOfferResponse,
  ChatMessageResponse,
  ChatTurn
} from "@aacp/shared-types";
import {
  checkoutJson,
  CHECKOUT_EMBED_PATHS,
  CHECKOUT_LEGACY_PATHS
} from "../lib/embed-client.js";
import type { WidgetConfig } from "../lib/widget-types.js";
import { bubbleKey, type QuickReplyChoice } from "./checkout-view-model.js";
import { disableStreamingByEnv } from "./use-streamed-text.js";
import type { CheckoutSessionState } from "./use-checkout-session.js";

const DEFAULT_QUICK_REPLIES: QuickReplyChoice[] = [
  { label: "Olá!" },
  { label: "Quero começar" },
  { label: "Quero finalizar agora" },
];

export function useCheckoutChat(config: WidgetConfig, sessionState: CheckoutSessionState) {
  const { session, activeExperience, syncExperience, networkError, apiOrigin, embedOpts } = sessionState;
  const isConversational = config.uiPresentation === "conversational";

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

  const checkoutStage = useMemo(() => {
    const apiStage = lastChat?.stage ?? activeExperience.stage;
    return apiStage ?? "data_collection";
  }, [activeExperience.stage, lastChat?.stage]);

  const awaitingAgentPlayback = !disableStreamingByEnv() && streamingTurnKey !== null && streamingDoneKey !== streamingTurnKey;
  const composerLocked = busy || Boolean(networkError) || awaitingAgentPlayback;

  const quickReplies = useMemo((): QuickReplyChoice[] => {
    if (!isConversational || turns.length < 1 || busy) return [];
    const list: QuickReplyChoice[] = [];
    if (!lastChat) {
      list.push(...DEFAULT_QUICK_REPLIES);
    } else if (lastChat.actions?.length) {
      list.push(...lastChat.actions.map((a) => ({ label: a.label, type: a.type as never, offerId: a.offer_id })));
    }
    if (activeExperience.copy.quick_replies.length > 0) {
      list.push(...activeExperience.copy.quick_replies.map((label) => ({ label })));
    }
    // Inject approved-offer chip if not already present
    if (lastChat?.authorized_offer?.approved && !list.some((r) => /desconto/i.test(r.label ?? ""))) {
      const offer = lastChat.authorized_offer;
      const pct = offer.type === "discount_percent" ? offer.value : 0;
      if (pct > 0 && offer.id) {
        list.push({ label: `Aplicar desconto de ${pct}%`, offerId: offer.id });
      }
    }

    const seen = new Set<string>();
    return list.filter((r) => {
      const key = (r.label ?? "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeExperience.copy.quick_replies, isConversational, lastChat, busy, turns.length]);

  useEffect(() => {
    if (streamingTurnKey == null) return;
    if (prevStreamingTurnKey.current === streamingTurnKey) return;
    prevStreamingTurnKey.current = streamingTurnKey;
    setStreamingDoneKey(null);
  }, [streamingTurnKey]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns.length, busy, streamingTurnKey, streamingDoneKey]);

  useEffect(() => {
    const showComposer = isConversational && Boolean(session) && !networkError && checkoutStage !== "completed" && checkoutStage !== "payment";
    if (!showComposer) return;
    composerInputRef.current?.focus();
  }, [isConversational, session, networkError, checkoutStage]);

  useEffect(() => {
    if (awaitingAgentPlayback) return;
    if (!isConversational || !session || networkError || checkoutStage === "completed" || checkoutStage === "payment") return;
    composerInputRef.current?.focus();
  }, [awaitingAgentPlayback, isConversational, session, networkError, checkoutStage]);

  // Initialize turns from /start response
  useEffect(() => {
    const ev = sessionState.startedEvent;
    if (!ev || ev.ts === prevStartTs.current) return;
    prevStartTs.current = ev.ts;

    const response = ev.response;
    if (Array.isArray(response.turns) && response.turns.length > 0) {
      setTurns(response.turns);
      const lastAgentIdx = response.turns.map((t) => t.role).lastIndexOf("agent");
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
      setTimeout(() => {
        const regTurn: ChatTurn = {
          role: "agent",
          text: "Antes de começar, preciso fazer o seu cadastro. Qual é o seu nome completo?",
          occurredAt: new Date().toISOString()
        };
        setTurns((curr) => {
          if (curr.length === 1 && curr[0]!.text === greeting.text) {
            setStreamingTurnKey(bubbleKey(regTurn, 1));
            return [...curr, regTurn];
          }
          return curr;
        });
      }, 1500);
    }
    if (response.initial_mode === "open") {
      // compositor handles setOpen
    }
  }, [sessionState.startedEvent]);

  // Network error → reset turns to fallback greeting
  useEffect(() => {
    if (!sessionState.startErrorTs) return;
    const fallbackTurn: ChatTurn = {
      role: "agent",
      text: "Estou tentando conectar com a API da loja para carregar seu pedido real.",
      occurredAt: new Date().toISOString()
    };
    setTurns([fallbackTurn]);
    setStreamingTurnKey(bubbleKey(fallbackTurn, 0));
  }, [sessionState.startErrorTs]);

  // Auto-trigger registration for conversational mode
  useEffect(() => {
    if (isConversational && session && turns.length === 1 && !config.customer?.fullName && !busy && !networkError && !disableStreamingByEnv()) {
      const timer = setTimeout(() => { void autoTriggerRegistration(); }, 1500);
      return () => clearTimeout(timer);
    }
  }, [session, turns.length, isConversational, busy, networkError, config.customer?.fullName]);

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

  async function sendMessageWithOverride(userText: string): Promise<void> {
    if (!session || networkError || !userText.trim() || composerLocked) return;
    setBusy(true);
    setTurns((current) => [...current, { role: "buyer", text: userText.trim(), occurredAt: new Date().toISOString() }]);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: userText.trim() }
        : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: userText.trim() };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, { ...embedOpts, body });
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
    await sendMessageWithOverride(userText);
  }

  async function autoTriggerRegistration(): Promise<void> {
    if (!session || networkError || composerLocked) return;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Iniciar cadastro" }
        : { merchant_id: config.merchantId, session_id: session.session_id, conversation_id: session.conversation_id, user_message: "Iniciar cadastro" };
      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, { ...embedOpts, body });
      applyTurnResponse(response);
    } catch {
      sessionState.setNetworkError?.("Falha ao falar com a IA. Tente novamente em instantes.");
    } finally {
      setBusy(false);
    }
  }

  async function applyOfferById(offerId?: string): Promise<void> {
    if (!session) return;
    const targetOffer =
      offerId && lastChat?.authorized_offer?.id === offerId
        ? lastChat.authorized_offer
        : lastChat?.authorized_offer;
    if (!targetOffer) return;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body = config.mode === "embed"
        ? { session_id: session.session_id, offer_id: targetOffer.id }
        : { merchant_id: config.merchantId, session_id: session.session_id, offer_id: targetOffer.id };
      const response = await checkoutJson<ApplyOfferResponse>(apiOrigin, paths.applyOffer, { ...embedOpts, body });
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

  async function submitCoupon(): Promise<void> {
    const code = coupon.trim();
    if (!code) return;
    setCoupon("");
    await sendMessageWithOverride(`Tenho o cupom: ${code}`);
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
    appendAgentTurn,
    handleAgentTypingDone,
    sendMessage,
    sendMessageWithOverride,
    tapQuick,
    applyOffer: () => applyOfferById(lastChat?.authorized_offer?.id),
    continueToPayment,
    submitCoupon,
    retryChat,
  };
}

export type CheckoutChatState = ReturnType<typeof useCheckoutChat>;
