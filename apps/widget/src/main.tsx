import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageCircle, Send, ShoppingBag, Sparkles, Tag, X } from "lucide-react";
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

interface ChatBubbleProps {
  turn: ChatTurn;
  agentName: string;
  shouldStream: boolean;
}

function ChatBubble({ turn, agentName, shouldStream }: ChatBubbleProps) {
  const { displayed, isStreaming } = useStreamedText(turn.text, { enabled: shouldStream });
  const showCaret = shouldStream && isStreaming;
  return (
    <div className={`aacp-chat-bubble aacp-chat-bubble--${turn.role}`}>
      {turn.role === "agent" ? (
        <span className="aacp-chat-meta">{agentName}</span>
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
  const [coupon, setCoupon] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

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
  }, [turns.length, busy]);

  function appendAgentTurn(text: string, opts: { stream?: boolean } = {}): void {
    const turn: ChatTurn = {
      role: "agent",
      text,
      occurredAt: new Date().toISOString()
    };
    const key = bubbleKey(turn, undefined);
    setTurns((current) => [...current, turn]);
    if (opts.stream) setStreamingTurnKey(key);
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
  const showCouponBox =
    (activeExperience.rules?.couponBoxEnabled !== false) && totals.discount === 0;
  const showOfferBanner = totals.discount > 0;

  const quickReplies: { label: string; event?: CheckoutEventName }[] = isConversational
    ? lastChat?.actions.length
      ? lastChat.actions.map((action) => ({ label: action.label }))
      : activeExperience.copy.quick_replies.map((label) => ({ label }))
    : [];

  async function tapQuick(label: string, event?: CheckoutEventName): Promise<void> {
    if (!session || networkError) return;
    if (event) void track(event);
    await sendMessageWithOverride(label);
  }

  async function sendMessageWithOverride(userText: string): Promise<void> {
    if (!session || networkError || !userText.trim()) return;
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
        const lastIndex = response.turns.length - 1;
        const last = response.turns[lastIndex];
        if (last && last.role === "agent") {
          setStreamingTurnKey(bubbleKey(last, lastIndex));
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

  async function applyOffer() {
    if (!session || !lastChat?.authorized_offer) return;
    setBusy(true);
    try {
      const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
      const body =
        config.mode === "embed"
          ? { session_id: session.session_id, offer_id: lastChat.authorized_offer!.id }
          : {
              merchant_id: config.merchantId,
              session_id: session.session_id,
              offer_id: lastChat.authorized_offer!.id
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
        <button
          type="button"
          className="aacp-cart-close"
          aria-label="Fechar resumo"
          onClick={() => setCartOpen(false)}
        >
          <X size={18} />
        </button>
      </header>

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
                <strong>{activeExperience.agent.name}</strong>
                <span>{activeExperience.brand.name} · online</span>
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

          <div className="aacp-chat-thread" role="log" aria-live="polite" ref={threadRef}>
            {turns.map((turn, index) => {
              const key = bubbleKey(turn, index);
              return (
                <ChatBubble
                  key={key}
                  turn={turn}
                  agentName={activeExperience.agent.name}
                  shouldStream={key === streamingTurnKey}
                />
              );
            })}
            {busy ? (
              <div
                className="aacp-typing"
                role="status"
                aria-label={`${activeExperience.agent.name} está digitando`}
              >
                <span className="aacp-typing-name">
                  {activeExperience.agent.name} está digitando
                </span>
                <span className="aacp-typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : null}
          </div>

          {showOfferBanner ? (
            <div className="aacp-offer-banner" role="status">
              <Sparkles size={16} aria-hidden="true" />
              <div className="aacp-offer-banner-text">
                <strong>Oferta aplicada</strong>
                <span>
                  −{formatCurrency(totals.discount, totals.currency)} · novo total{" "}
                  {formatCurrency(totals.total, totals.currency)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void continueToPayment()}
                disabled={busy || Boolean(networkError)}
              >
                Continuar para pagamento
              </button>
            </div>
          ) : null}

          {quickReplies.length > 0 ? (
            <div className="aacp-quick-replies" role="group" aria-label="Respostas sugeridas">
              {quickReplies.map(({ label, event }) => (
                <button
                  key={label}
                  type="button"
                  disabled={busy || !session || Boolean(networkError)}
                  onClick={() => void tapQuick(label, event)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="aacp-input-form"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Digite sua mensagem para a IA…"
              disabled={busy || Boolean(networkError)}
              aria-label="Mensagem para o assistente"
            />
            <button
              type="submit"
              aria-label="Enviar mensagem"
              disabled={busy || Boolean(networkError) || !message.trim()}
            >
              <Send size={18} />
            </button>
          </form>
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
