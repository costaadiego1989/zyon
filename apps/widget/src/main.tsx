import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CheckCircle2,
  CreditCard,
  LockKeyhole,
  MessageCircle,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Truck,
  UserRound,
  X
} from "lucide-react";
import type {
  ChatAction,
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
} from "./embed-client.js";
import { useStreamedText } from "./use-streamed-text.js";
import "./styles.css";

interface WidgetConfig {
  mode: "legacy" | "embed";
  embedSessionToken?: string;
  merchantId: string;
  apiBaseUrl: string;
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  uiPresentation: "floating" | "conversational";
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function fallbackExperience(config: WidgetConfig): CheckoutExperienceSnapshot {
  const shipping = config.shipping?.customerPrice ?? 0;
  const discount = config.cart.currentDiscount ?? 0;
  return {
    brand: {
      merchant_id: config.merchantId,
      name: config.merchantId,
      subtitle: "Checkout assistido por IA",
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
      name: "Assistente AACP",
      greeting: "Estou conectando com a API da loja para carregar o pedido.",
      tone: "consultative",
      language: "pt-BR"
    },
    copy: {
      headline: "Checkout assistido por IA",
      subheadline: "Carregando contexto real do pedido.",
      trust_badges: ["Sessão será sincronizada pela API"],
      quick_replies: ["Olá!", "Quero finalizar agora"]
    },
    rules: { couponBoxEnabled: true }
  };
}

export function themeStyle(theme: MerchantTheme): React.CSSProperties {
  return {
    "--aacp-accent": theme.accentColor,
    "--aacp-fg": theme.textColor,
    "--aacp-bg": theme.backgroundColor,
    "--aacp-font": theme.fontFamily
  } as React.CSSProperties;
}

export type { WidgetConfig };

function filterSuggestedQuickReplies(
  replies: { label: string; event?: CheckoutEventName }[],
  stage?: CheckoutExperienceSnapshot["stage"]
): { label: string; event?: CheckoutEventName }[] {
  if (stage === "payment") return replies;
  const couponLike = /\b(cup[oô]m|promo|c[oó]digo(\s+(promocional|de\s+desconto))?|desconto\s+extra|%?\s*off)\b/i;
  return replies.filter(({ label }) => !couponLike.test(label));
}

const CHECKOUT_STAGES: Array<NonNullable<CheckoutExperienceSnapshot["stage"]>> = [
  "data_collection",
  "shipping",
  "payment",
  "completed"
];

function stageLabel(stage: CheckoutExperienceSnapshot["stage"]): string {
  switch (stage) {
    case "data_collection":
      return "Cadastro";
    case "shipping":
      return "Frete e endereço";
    case "payment":
      return "Pagamento";
    case "completed":
      return "Pedido confirmado";
    default:
      return "Cadastro";
  }
}

interface QuickReplyChoice {
  label: string;
  event?: CheckoutEventName;
  type?: ChatAction["type"];
  offerId?: string;
}

function stageNarrative(stage: CheckoutExperienceSnapshot["stage"], nextField?: string): string {
  switch (stage) {
    case "data_collection":
      if (nextField === "nome") return "Welcome message. Vamos iniciar com seu nome completo para personalizar a jornada.";
      if (nextField === "email") return "Envie seu e-mail para receber o código de confirmação e validar o cadastro.";
      if (nextField === "CPF") return "Agora vamos registrar o CPF para seguir com a etapa fiscal com segurança.";
      if (nextField === "telefone") return "Quase lá. Informe o telefone com DDD para destravar a próxima etapa.";
      return "Vamos fechar seu cadastro antes de negociar preço, frete ou cupom.";
    case "shipping":
      if (nextField === "CEP") return "Agora vamos cotar o frete com o CEP de entrega.";
      if (nextField === "confirmar CEP") return "O CEP precisa ser confirmado para prosseguirmos com o endereço.";
      if (nextField?.includes("número")) return "Só falta o número do endereço para concluir a cotação.";
      if (nextField?.includes("frete")) return "A cotação está em andamento e a próxima mensagem destrava o valor final.";
      return "Endereço validado. Agora seguimos para o frete e a conferência final.";
    case "payment":
      return "Escolha o tipo de pagamento, confirme no link seguro e finalize a compra.";
    case "completed":
      return "Pedido confirmado. O rastreio e os detalhes da compra seguem no resumo final.";
    default:
      return "Checkout assistido por IA em andamento.";
  }
}

function quickReplyId(reply: QuickReplyChoice): string {
  return [reply.label, reply.type ?? "copy", reply.offerId ?? "", reply.event ?? ""].join("|");
}

function stageIcon(stage: CheckoutExperienceSnapshot["stage"]) {
  switch (stage) {
    case "data_collection":
      return <UserRound size={15} aria-hidden="true" />;
    case "shipping":
      return <Truck size={15} aria-hidden="true" />;
    case "payment":
      return <CreditCard size={15} aria-hidden="true" />;
    case "completed":
      return <CheckCircle2 size={15} aria-hidden="true" />;
    default:
      return <UserRound size={15} aria-hidden="true" />;
  }
}

function stageProgress(stage: CheckoutExperienceSnapshot["stage"]): number {
  const current = stage ?? "data_collection";
  const index = Math.max(0, CHECKOUT_STAGES.indexOf(current));
  return Math.round(((index + 1) / CHECKOUT_STAGES.length) * 100);
}

function agentGivenAndRest(agentFullName: string): { given: string; rest: string } {
  const trimmed = agentFullName.trim();
  if (!trimmed) return { given: "Assistente", rest: "" };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const given = tokens[0] ?? trimmed;
  const rest = tokens.slice(1).join(" ").trim();
  return { given, rest };
}

function agentTypingLine(agentFullName: string): string {
  const trimmed = agentFullName.trim();
  if (!trimmed) return "Assistente está digitando";
  return `${trimmed} está digitando`;
}

interface ChatBubbleProps {
  turn: ChatTurn;
  agentName: string;
  bubbleKey: string;
  streamingKey: string | null;
  onAgentTypingDone?: (key: string) => void;
}

function ChatBubble({ turn, agentName, bubbleKey, streamingKey, onAgentTypingDone }: ChatBubbleProps) {
  const shouldStream =
    streamingKey !== null && bubbleKey === streamingKey && turn.role === "agent";
  const { displayed, isStreaming } = useStreamedText(turn.text, {
    enabled: shouldStream,
    skipCompleteWhenDisabled: turn.role === "agent",
    onComplete: turn.role === "agent" ? () => onAgentTypingDone?.(bubbleKey) : undefined
  });
  const showCaret = shouldStream && isStreaming;
  const { given, rest } = agentGivenAndRest(agentName);
  return (
    <div className={`aacp-chat-bubble aacp-chat-bubble--${turn.role}`}>
      {turn.role === "agent" ? (
        <span className={`aacp-chat-meta${rest ? " aacp-chat-meta--compound" : ""}`}>
          <span className="aacp-chat-meta-given">{given}</span>
          {rest ? (
            <>
              <span className="aacp-chat-meta-sep" aria-hidden="true">
                ·
              </span>
              <span className="aacp-chat-meta-rest">{rest}</span>
            </>
          ) : null}
        </span>
      ) : null}
      <span className="aacp-chat-text">
        {displayed}
        {showCaret ? <span className="aacp-chat-caret" aria-hidden="true" /> : null}
      </span>
    </div>
  );
}

export function CheckoutAgent({ config }: { config: WidgetConfig }) {
  const isConversational = config.uiPresentation === "conversational";
  const [session, setSession] = useState<StartCheckoutResponse | null>(null);
  const [open, setOpen] = useState(isConversational);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [lastChat, setLastChat] = useState<ChatMessageResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [experience, setExperience] = useState<CheckoutExperienceSnapshot | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [streamingTurnKey, setStreamingTurnKey] = useState<string | null>(null);
  const [streamingDoneKey, setStreamingDoneKey] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);

  const prevStreamingTurnKey = useRef<string | null>(null);

  useEffect(() => {
    if (streamingTurnKey == null) return;
    if (prevStreamingTurnKey.current === streamingTurnKey) return;
    prevStreamingTurnKey.current = streamingTurnKey;
    setStreamingDoneKey(null);
  }, [streamingTurnKey]);

  const apiOrigin = useMemo(() => normalizeApiBase(config.apiBaseUrl), [config.apiBaseUrl]);
  const embedOpts = config.mode === "embed" ? { embedToken: config.embedSessionToken! } : {};

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
  }, []);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns.length, busy, streamingTurnKey, streamingDoneKey]);

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

  async function startCheckout() {
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body =
      config.mode === "embed"
        ? { customer: config.customer, cart: config.cart, shipping: config.shipping }
        : {
            merchant_id: config.merchantId,
            customer: config.customer,
            cart: config.cart,
            shipping: config.shipping
          };

    try {
      const response = await checkoutJson<StartCheckoutResponse>(apiOrigin, paths.start, {
        ...embedOpts,
        body
      });

      setSession(response);
      setExperience(response.experience);
      setNetworkError(null);
      const greeting: ChatTurn = {
        role: "agent",
        text: response.experience.agent.greeting,
        occurredAt: new Date().toISOString()
      };
      setTurns([greeting]);
      setStreamingTurnKey(bubbleKey(greeting, 0));
      if (response.initial_mode === "open") setOpen(true);
      window.localStorage.setItem("aacp_global_user_id", response.global_user_id);
    } catch {
      setNetworkError(
        "Não consegui sincronizar esta sessão com a API agora. A conversa ficará bloqueada até a conexão voltar."
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
          "Vi que talvez exista alguma dúvida no checkout. Posso tentar uma condição melhor para você finalizar agora?",
          { stream: true }
        );
      }
    }
  }

  const activeExperience = experience ?? fallbackExperience(config);
  const theme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const offer = lastChat?.authorized_offer;
  const totals = activeExperience.totals;
  const checkoutStage = activeExperience.stage ?? "data_collection";
  const nextMissingField = lastChat?.missing_fields?.[0];
  const agentNameParts = agentGivenAndRest(activeExperience.agent.name);
  const progress = stageProgress(checkoutStage);
  const hasVerifiedEmail = Boolean(activeExperience.customer?.email_verified);
  const stageNote = stageNarrative(checkoutStage, nextMissingField);
  const guardrailSignals = [
    "Oferta por politica",
    "Margem protegida",
    "Sem dados sensiveis"
  ];
  const heroSignals = [
    { label: "Stage", value: stageLabel(checkoutStage) },
    { label: "Identity", value: hasVerifiedEmail ? "Verified" : "Awaiting email" },
    { label: "Total", value: formatCurrency(totals.total, totals.currency) }
  ];

  function handleAgentTypingDone(key: string): void {
    if (streamingTurnKey === key) setStreamingDoneKey(key);
  }

  const awaitingAgentPlayback =
    streamingTurnKey !== null && streamingDoneKey !== streamingTurnKey;
  const composerLockedConversational =
    busy || Boolean(networkError) || awaitingAgentPlayback;

  /** Só quando a IA terminou — mostra slot de digitação / chips no fluxo da conversa. */
  const conversationalReplyReady =
    isConversational &&
    Boolean(session) &&
    !networkError &&
    !busy &&
    !awaitingAgentPlayback;
  const showComposer = conversationalReplyReady && checkoutStage !== "completed";

  useEffect(() => {
    if (!showComposer) return;
    composerInputRef.current?.focus();
  }, [showComposer]);

  const showCouponBox =
    checkoutStage === "payment" &&
    (activeExperience.rules?.couponBoxEnabled !== false) &&
    totals.discount === 0;
  const showOfferBanner = totals.discount > 0;

  const mergedQuickReplies: QuickReplyChoice[] = isConversational
    ? [
        ...(lastChat?.actions ?? []).map((action) => ({
          label: action.label,
          type: action.type,
          offerId: action.offer_id
        })),
        ...filterSuggestedQuickReplies(
          activeExperience.copy.quick_replies.map((label) => ({ label })),
          checkoutStage
        )
      ]
    : [];

  const quickReplies: QuickReplyChoice[] = mergedQuickReplies.filter(
    (reply, index, list) =>
      index === list.findIndex((item) => item.label === reply.label && item.type === reply.type)
  );

  async function tapQuick(reply: QuickReplyChoice): Promise<void> {
    if (!session || networkError || composerLockedConversational) return;
    if (reply.event) void track(reply.event);
    if (reply.type === "apply_offer") {
      await applyOfferById(reply.offerId);
      return;
    }
    await sendMessageWithOverride(reply.label);
  }

  async function sendMessageWithOverride(userText: string): Promise<void> {
    if (!session || networkError || !userText.trim() || composerLockedConversational) return;
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
      if (response.experience) setExperience(response.experience);

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
        const reply: ChatTurn = {
          role: "agent",
          text: response.message,
          occurredAt: new Date().toISOString()
        };
        setTurns((current) => {
          const next = [...current, reply];
          setStreamingTurnKey(bubbleKey(reply, next.length - 1));
          return next;
        });
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
      if (response.experience) setExperience(response.experience);
      if (response.agent_turn) {
        setTurns((current) => {
          const next = [...current, response.agent_turn as ChatTurn];
          setStreamingTurnKey(bubbleKey(next[next.length - 1]!, next.length - 1));
          return next;
        });
      } else {
        appendAgentTurn(
          response.success
            ? `Oferta aplicada. Código: ${response.discount_code ?? "gerado"}.`
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
            ? ` Copia e cola PIX: ${bf.qrCodeCopyPaste.slice(0, 80)}${
                bf.qrCodeCopyPaste.length > 80 ? "…" : ""
              }.`
            : "";

      appendAgentTurn(total.length > 0 ? `Cobrança gerada (${total}).${pixLine}` : `Cobrança criada.${pixLine}`, {
        stream: true
      });
    } catch {
      appendAgentTurn(
        "Não foi possível gerar a cobrança (sessão/demo ou servidor). Verifique o token embed e dados do pagador na API.",
        { stream: true }
      );
    } finally {
      setBusy(false);
    }
  }

  if (!isConversational) {
    return (
      <section className="aacp-widget" style={themeStyle(theme)}>
        {open ? (
          <div className="aacp-panel">
            <header>
              <div>
                <strong>Assistente de checkout</strong>
                <span>
                  {session?.global_user_id
                    ? `Cliente ${session.global_user_id.slice(0, 12)}`
                    : "Conectando à API..."}
                </span>
              </div>
              <button type="button" aria-label="Fechar chat" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="aacp-lines" role="log" aria-live="polite">
              {turns.map((turn, index) => (
                <p key={`${turn.role}-${index}-${turn.occurredAt}`} className={turn.role}>
                  {turn.text}
                </p>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Digite sua dúvida..."
                disabled={busy || Boolean(networkError)}
                aria-label="Mensagem para o assistente"
              />
              <button type="submit" aria-label="Enviar mensagem" disabled={busy || !message.trim()}>
                <Send size={18} />
              </button>
            </form>
          </div>
        ) : (
          <button
            type="button"
            className="aacp-launcher"
            aria-label="Abrir assistente"
            onClick={() => setOpen(true)}
          >
            <MessageCircle size={24} />
          </button>
        )}
      </section>
    );
  }

  const cartCard = (
    <section className="aacp-cart" aria-label="Resumo do pedido">
      <header className="aacp-cart-header">
        <div className="aacp-cart-brand">
          {theme.logoUrl ? (
            <img src={theme.logoUrl} alt={activeExperience.brand.name} className="aacp-cart-logo" />
          ) : (
            <div className="aacp-cart-logo aacp-cart-logo--placeholder" aria-hidden="true">
              <ShoppingBag size={20} />
            </div>
          )}
          <div>
            <strong>{activeExperience.brand.name}</strong>
            <span>{activeExperience.copy.headline}</span>
          </div>
        </div>
        <div className="aacp-cart-header-badge">
          <span>Agentic</span>
          <strong>{stageLabel(checkoutStage)}</strong>
        </div>
        <button
          type="button"
          className="aacp-cart-close"
          aria-label="Fechar resumo"
          onClick={() => setCartOpen(false)}
        >
          <X size={18} />
        </button>
      </header>

      <div className="aacp-cart-orbit">
        <span>Premium checkout rail</span>
        <strong>{stageNote}</strong>
        <p>
          IA, regras comerciais, frete e pagamento sincronizados em tempo real pela API da loja.
        </p>
      </div>

      <div className="aacp-cart-intel" aria-label="Sinais comerciais do checkout">
        <div>
          <span>Etapa</span>
          <strong>{stageLabel(checkoutStage)}</strong>
        </div>
        <div>
          <span>Frete</span>
          <strong>{totals.shipping > 0 ? formatCurrency(totals.shipping, totals.currency) : "A validar"}</strong>
        </div>
        <div>
          <span>Protecao</span>
          <strong>{showOfferBanner ? "Oferta aplicada" : "Ativa"}</strong>
        </div>
      </div>

      <ul className="aacp-cart-items">
        {activeExperience.items.map((item) => (
          <li className="aacp-cart-item" key={item.sku}>
            {item.image_url ? (
              <img src={item.image_url} alt={item.name} className="aacp-cart-thumb" />
            ) : (
              <div className="aacp-cart-thumb aacp-cart-thumb--placeholder" aria-hidden="true">
                <ShoppingBag size={20} />
              </div>
            )}
            <div className="aacp-cart-item-body">
              <strong>{item.name}</strong>
              {item.variant ? <span className="aacp-cart-variant">{item.variant}</span> : null}
              <span className="aacp-cart-qty">Qtd × {item.quantity}</span>
            </div>
            <span className="aacp-cart-line-total">
              {formatCurrency(item.line_total, totals.currency)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="aacp-cart-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatCurrency(totals.subtotal, totals.currency)}</dd>
        </div>
        {totals.shipping > 0 ? (
          <div>
            <dt>Frete</dt>
            <dd>{formatCurrency(totals.shipping, totals.currency)}</dd>
          </div>
        ) : null}
        {totals.discount > 0 ? (
          <div className="aacp-cart-discount">
            <dt>Desconto</dt>
            <dd>−{formatCurrency(totals.discount, totals.currency)}</dd>
          </div>
        ) : null}
        <div className="aacp-cart-total">
          <dt>Total</dt>
          <dd>{formatCurrency(totals.total, totals.currency)}</dd>
        </div>
      </dl>

      {showCouponBox ? (
        <form
          className="aacp-cart-coupon"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCoupon();
          }}
        >
          <Tag size={16} aria-hidden="true" />
          <input
            value={coupon}
            onChange={(event) => setCoupon(event.target.value)}
            placeholder="Cupom de desconto"
            aria-label="Cupom de desconto"
            disabled={busy || Boolean(networkError)}
          />
          <button type="submit" disabled={busy || !coupon.trim()}>
            Aplicar
          </button>
        </form>
      ) : null}

      {offer?.approved ? (
        <button
          type="button"
          className="aacp-cart-cta"
          disabled={busy}
          onClick={() => void applyOffer()}
        >
          Aplicar oferta autorizada
        </button>
      ) : null}

      {config.mode === "embed" && session ? (
        <button
          type="button"
          className="aacp-cart-cta aacp-cart-cta--secondary"
          disabled={busy}
          onClick={() => void createEmbedPaymentIntentDemo()}
        >
          Demo: gerar cobrança (PIX)
        </button>
      ) : null}

      <ul className="aacp-cart-trust">
        <li>Regras comerciais validadas pela API</li>
        <li>Agente nao solicita senha ou CVV no chat</li>
        {activeExperience.copy.trust_badges.slice(0, 3).map((badge) => (
          <li key={badge}>{badge}</li>
        ))}
      </ul>
    </section>
  );

  return (
    <section
      className="aacp-widget aacp-widget--conversational"
      style={themeStyle(theme)}
      data-cart-open={cartOpen ? "true" : undefined}
    >
      {cartOpen ? (
        <button
          type="button"
          className="aacp-sheet-backdrop"
          aria-label="Fechar resumo do pedido"
          onClick={() => setCartOpen(false)}
        />
      ) : null}
      <div className="aacp-shell">
        <div className="aacp-conversation">
          <header className="aacp-shell-header">
            <div className="aacp-agent-meta">
              <div className="aacp-agent-avatar" aria-hidden="true">
                {theme.agentAvatarUrl ? (
                  <img src={theme.agentAvatarUrl} alt="" />
                ) : (
                  <Sparkles size={18} />
                )}
                <span className="aacp-agent-status" />
              </div>
              <div>
                <div className="aacp-shell-agent-name">
                  <strong className="aacp-shell-name-given">{agentNameParts.given}</strong>
                  {agentNameParts.rest ? (
                    <>
                      <span className="aacp-shell-name-sep" aria-hidden="true">
                        ·
                      </span>
                      <span className="aacp-shell-name-rest">{agentNameParts.rest}</span>
                    </>
                  ) : null}
                </div>
                <span className="aacp-agent-subtitle">
                  {activeExperience.brand.name} · online
                </span>
              </div>
            </div>
            <button
              type="button"
              className="aacp-cart-toggle"
              onClick={() => setCartOpen((current) => !current)}
              aria-expanded={cartOpen}
              aria-controls="aacp-cart-mobile"
            >
              <ShoppingBag size={16} aria-hidden="true" />
              <span>{formatCurrency(totals.total, totals.currency)}</span>
            </button>
          </header>

          {networkError ? (
            <div className="aacp-network-error" role="alert">
              <span>{networkError}</span>
              <button
                type="button"
                className="aacp-retry"
                onClick={() => {
                  setNetworkError(null);
                  setTurns([]);
                  void startCheckout();
                }}
              >
                Tentar novamente
              </button>
            </div>
          ) : null}

          <div className="aacp-conversation-flow">
            <section className="aacp-hero" aria-label="Resumo executivo do checkout">
              <div className="aacp-hero-copy">
                <span className="aacp-hero-kicker">
                  <Sparkles size={14} aria-hidden="true" />
                  Agentic enterprise checkout
                </span>
                <h1>{activeExperience.copy.headline}</h1>
                <p>{activeExperience.copy.subheadline}</p>
                <div className="aacp-hero-tags" aria-label="Indicadores do checkout">
                  {heroSignals.map((signal) => (
                    <span key={signal.label}>
                      <strong>{signal.label}</strong>
                      <em>{signal.value}</em>
                    </span>
                  ))}
                </div>
              </div>
              <div className="aacp-hero-panel">
                <div>
                  <span>Agent mode</span>
                  <strong>{isConversational ? "Conversational" : "Floating"}</strong>
                </div>
                <div>
                  <span>Trust gate</span>
                  <strong>{hasVerifiedEmail ? "Identity cleared" : "Email pending"}</strong>
                </div>
                <div>
                  <span>Rule engine</span>
                  <strong>{showOfferBanner ? "Discount active" : "Guardrails on"}</strong>
                </div>
              </div>
            </section>
            <div className="aacp-command-strip" aria-label="Status do checkout agentico">
              <div className="aacp-stage-card">
                <div className="aacp-stage-card-head">
                  <span className="aacp-stage-icon">{stageIcon(checkoutStage)}</span>
                  <div>
                    <span>Mission stage</span>
                    <strong>{stageLabel(checkoutStage)}</strong>
                  </div>
                </div>
                <p className="aacp-stage-note">{stageNote}</p>
                <div className="aacp-stage-subgrid" aria-label="Detalhes executivos do checkout">
                  <div>
                    <span>Canal</span>
                    <strong>{isConversational ? "Conversational AI" : "Floating checkout"}</strong>
                  </div>
                  <div>
                    <span>Identidade</span>
                    <strong>{hasVerifiedEmail ? "Verificada" : "Em validação"}</strong>
                  </div>
                </div>
                <div
                  className="aacp-stage-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  aria-label="Progresso do checkout"
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="aacp-guardrail-row" aria-label="Guardrails ativos">
                {guardrailSignals.map((signal) => (
                  <span key={signal}>
                    <ShieldCheck size={14} aria-hidden="true" />
                    {signal}
                  </span>
                ))}
                <span>
                  <LockKeyhole size={14} aria-hidden="true" />
                  {hasVerifiedEmail ? "Email verificado" : "Identidade em coleta"}
                </span>
              </div>
            </div>
            <div className="aacp-chat-thread" role="log" aria-live="polite" ref={threadRef}>
              {turns.map((turn, index) => {
                const key = bubbleKey(turn, index);
                return (
                  <ChatBubble
                    key={key}
                    turn={turn}
                    agentName={activeExperience.agent.name}
                    bubbleKey={key}
                    streamingKey={streamingTurnKey}
                    onAgentTypingDone={handleAgentTypingDone}
                  />
                );
              })}
              {busy ? (
                <div
                  className="aacp-typing"
                  role="status"
                  aria-label={agentTypingLine(activeExperience.agent.name)}
                >
                  <span className="aacp-typing-name">
                    <span className="aacp-typing-name-given">{agentNameParts.given}</span>
                    {agentNameParts.rest ? (
                      <span className="aacp-typing-name-rest">{` ${agentNameParts.rest}`}</span>
                    ) : null}
                    <span className="aacp-typing-name-tail"> está digitando</span>
                  </span>
                  <span className="aacp-typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              ) : null}

              {showOfferBanner ? (
                <div className="aacp-offer-banner aacp-offer-banner--in-thread" role="status">
                  <Sparkles size={16} aria-hidden="true" />
                  <div className="aacp-offer-banner-text">
                    <strong>Oferta aplicada</strong>
                    <span>
                      −{formatCurrency(totals.discount, totals.currency)} · novo total{" "}
                      {formatCurrency(totals.total, totals.currency)}
                    </span>
                  </div>
                  <button type="button" onClick={() => void continueToPayment()} disabled={busy}>
                    Continuar para pagamento
                  </button>
                </div>
              ) : null}

              {showComposer && quickReplies.length > 0 ? (
                <div
                  className="aacp-quick-replies aacp-quick-replies--in-thread"
                  role="group"
                  aria-label="Respostas sugeridas"
                >
                  {quickReplies.map((reply) => (
                    <button key={quickReplyId(reply)} type="button" onClick={() => void tapQuick(reply)}>
                      {reply.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {checkoutStage === "completed" ? (
                <div className="aacp-completion-card" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <div>
                    <strong>Pedido confirmado</strong>
                    <span>
                      {lastChat?.message ??
                        "Seu pedido foi confirmado. Em breve você receberá os detalhes, o código de rastreio e o resumo do checkout."}
                    </span>
                  </div>
                </div>
              ) : null}

              {showComposer ? (
                <div className="aacp-reply-slot">
                  <p className="aacp-reply-slot-hint" id="aacp-inline-composer-label">
                    {activeExperience.copy.expected_input_type === "email"
                      ? "Digite seu email para avançar"
                      : activeExperience.copy.expected_input_type === "tel"
                        ? "Digite seu telefone com DDD"
                        : activeExperience.copy.expected_input_type === "number"
                          ? "Digite o dado solicitado apenas com números"
                          : "Sua vez - quando quiser, responda"}
                  </p>
                  <form
                    className="aacp-input-form aacp-input-form--inline"
                    aria-labelledby="aacp-inline-composer-label"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendMessage();
                    }}
                  >
                    <input
                      ref={composerInputRef}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder={
                        checkoutStage === "payment"
                          ? "Prefiro PIX"
                          : checkoutStage === "shipping"
                            ? "Digite o CEP ou o número"
                            : "Escreva sua mensagem..."
                      }
                      aria-label="Mensagem para o assistente"
                      autoComplete="off"
                      type={
                        activeExperience.copy.expected_input_type === "email"
                          ? "email"
                          : activeExperience.copy.expected_input_type === "tel"
                            ? "tel"
                            : "text"
                      }
                      inputMode={activeExperience.copy.expected_input_type === "number" ? "numeric" : undefined}
                      pattern={activeExperience.copy.expected_input_type === "number" ? "[0-9]*" : undefined}
                    />
                    <button type="submit" aria-label="Enviar mensagem" disabled={!message.trim()}>
                      <Send size={18} />
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside
          id="aacp-cart-mobile"
          className="aacp-cart-pane"
          aria-hidden={!cartOpen ? undefined : "false"}
        >
          {cartCard}
        </aside>
      </div>
    </section>
  );
}

function bubbleKey(turn: ChatTurn, index?: number): string {
  return `${turn.role}-${turn.occurredAt}-${index ?? "x"}`;
}

const WIDGET_CE_NAME = "aacp-checkout-agent";

const ATTRS = [
  "embed-session-token",
  "api-base-url",
  "embed-api-base-url",
  "merchant-id",
  "cart-json",
  "customer-json",
  "shipping-json",
  "ui-presentation"
] as const;

function widgetReloadKey(cfg: WidgetConfig): string {
  const base = cfg.mode === "embed" ? `embed:${cfg.embedSessionToken}` : `legacy:${cfg.merchantId}`;
  return `${base}:${cfg.uiPresentation}:${cfg.cart.total}`;
}

function parseAttrJson<T>(value: string | null, fallback: T): T {
  if (!value?.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readConfig(element: HTMLElement): WidgetConfig {
  const embedSessionToken = element.getAttribute("embed-session-token")?.trim() || undefined;
  const merchantIdFromAttr = element.getAttribute("merchant-id")?.trim() || "mrc_demo";

  const mode = embedSessionToken ? ("embed" as const) : ("legacy" as const);

  const apiRaw =
    element.getAttribute("embed-api-base-url")?.trim() ??
    element.getAttribute("api-base-url")?.trim() ??
    null;

  const pres = element.getAttribute("ui-presentation")?.trim().toLowerCase();
  const uiPresentation =
    pres === "conversational" ? ("conversational" as const) : ("floating" as const);

  return {
    mode,
    merchantId: merchantIdFromAttr,
    ...(embedSessionToken ? { embedSessionToken } : {}),
    apiBaseUrl: apiRaw ?? "http://localhost:3000",
    cart: parseAttrJson<Cart>(element.getAttribute("cart-json"), {
      currency: "BRL",
      source: "storefront",
      total: 0,
      items: []
    }),
    customer: parseAttrJson<CustomerHints | undefined>(element.getAttribute("customer-json"), undefined),
    shipping: parseAttrJson<ShippingQuote | undefined>(element.getAttribute("shipping-json"), undefined),
    uiPresentation
  };
}

class AacpCheckoutAgentElement extends HTMLElement {
  private root?: Root;
  private host?: HTMLDivElement;

  static get observedAttributes(): readonly string[] {
    return ATTRS;
  }

  connectedCallback(): void {
    this.mount();
  }

  attributeChangedCallback(_name: string, prev: string | null, next: string | null): void {
    if (prev === next) return;
    this.mount();
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = undefined;
    this.host?.remove();
    this.host = undefined;
  }

  private mount(): void {
    if (!this.host) {
      this.host = document.createElement("div");
      this.append(this.host);
      this.root = createRoot(this.host);
    }
    const config = readConfig(this);
    this.root!.render(<CheckoutAgent key={widgetReloadKey(config)} config={config} />);
  }
}

if (!globalThis.customElements?.get(WIDGET_CE_NAME)) {
  globalThis.customElements.define(WIDGET_CE_NAME, AacpCheckoutAgentElement);
}
