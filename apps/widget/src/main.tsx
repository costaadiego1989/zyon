import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageCircle, Send, X } from "lucide-react";
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
      quick_replies: ["Tenho dúvida sobre o frete", "Quero finalizar agora"]
    }
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
      setTurns([
        {
          role: "agent",
          text: response.experience.agent.greeting,
          occurredAt: new Date().toISOString()
        }
      ]);
      if (response.initial_mode === "open") setOpen(true);
      window.localStorage.setItem("aacp_global_user_id", response.global_user_id);
    } catch {
      setNetworkError(
        "Não consegui sincronizar esta sessão com a API agora. A conversa ficará bloqueada até a conexão voltar."
      );
      setTurns([
        {
          role: "agent",
          text: "Estou tentando conectar com a API da loja para carregar seu pedido real.",
          occurredAt: new Date().toISOString()
        }
      ]);
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
        setTurns((current) => [
          ...current,
          {
            role: "agent",
            text: "Vi que talvez exista alguma dúvida no checkout. Posso tentar uma condição melhor para você finalizar agora?",
            occurredAt: new Date().toISOString()
          }
        ]);
      }
    }
  }

  const activeExperience = experience ?? fallbackExperience(config);
  const theme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
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
      if (Array.isArray(response.turns) && response.turns.length > 0) {
        setTurns(response.turns);
      } else {
        setTurns((current) => [
          ...current,
          { role: "agent", text: response.message, occurredAt: new Date().toISOString() }
        ]);
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
      setTurns((current) => [
        ...current,
        {
          role: "agent",
          text: response.success
            ? `Oferta aplicada. Código: ${response.discount_code ?? "gerado"}.`
            : `Não consegui aplicar a oferta: ${response.reason ?? "erro desconhecido"}.`,
          occurredAt: new Date().toISOString()
        }
      ]);
      if (response.apply_url) window.location.href = response.apply_url;
    } finally {
      setBusy(false);
    }
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

      const offer = lastChat?.authorized_offer;
      const body = {
        session_id: session.session_id,
        idempotency_key: crypto.randomUUID(),
        method: "pix" as const,
        ...(offer?.approved && offer.id ? { accepted_offer_id: offer.id } : {})
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

      setTurns((current) => [
        ...current,
        {
          role: "agent",
          text:
            total.length > 0
              ? `Cobrança gerada (${total}).${pixLine}`
              : `Cobrança criada.${pixLine}`,
          occurredAt: new Date().toISOString()
        }
      ]);
    } catch {
      setTurns((current) => [
        ...current,
        {
          role: "agent",
          text: "Não foi possível gerar a cobrança (sessão/demo ou servidor). Verifique o token embed e dados do pagador na API.",
          occurredAt: new Date().toISOString()
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!isConversational) {
    return (
      <section className="aacp-widget">
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

  const offer = lastChat?.authorized_offer;

  return (
    <section className="aacp-widget aacp-widget--conversational" style={themeStyle(theme)}>
      <div className="aacp-panel aacp-panel--conversational">
        <header>
          {theme.logoUrl ? (
            <img className="aacp-brand-logo" src={theme.logoUrl} alt={activeExperience.brand.name} />
          ) : (
            <div className="aacp-brand-logo" aria-hidden="true" />
          )}
          <div className="aacp-brand-meta">
            <strong>{activeExperience.brand.name}</strong>
            <span>{activeExperience.brand.subtitle ?? "Checkout assistido por IA"}</span>
          </div>
          <span className="aacp-status-pill" aria-label="Fluxo guiado pela IA">
            IA ativa
          </span>
        </header>

        {networkError ? (
          <p className="aacp-network-error" role="alert">
            {networkError}
          </p>
        ) : null}

        <div className="aacp-chat-thread" role="log" aria-live="polite" ref={threadRef}>
          {turns.map((turn, index) => (
            <div
              key={`${turn.role}-${index}-${turn.occurredAt}`}
              className={`aacp-chat-bubble aacp-chat-bubble--${turn.role}`}
            >
              {turn.text}
            </div>
          ))}
          {busy ? (
            <div className="aacp-typing" role="status" aria-label="Assistente digitando">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>

        <aside className="aacp-summary-sheet" aria-label="Resumo do pedido">
          <strong>{activeExperience.copy.headline}</strong>
          {activeExperience.items.slice(0, 4).map((item) => (
            <div className="aacp-summary-row" key={item.sku}>
              <span>
                {item.quantity}× {item.name}
              </span>
              <span>{formatCurrency(item.line_total, activeExperience.totals.currency)}</span>
            </div>
          ))}
          <div className="aacp-summary-row">
            <span>Subtotal</span>
            <span>{formatCurrency(activeExperience.totals.subtotal, activeExperience.totals.currency)}</span>
          </div>
          {activeExperience.totals.shipping > 0 ? (
            <div className="aacp-summary-row">
              <span>Frete</span>
              <span>{formatCurrency(activeExperience.totals.shipping, activeExperience.totals.currency)}</span>
            </div>
          ) : null}
          {activeExperience.totals.discount > 0 ? (
            <div className="aacp-summary-row">
              <span>Desconto</span>
              <span>-{formatCurrency(activeExperience.totals.discount, activeExperience.totals.currency)}</span>
            </div>
          ) : null}
          <div className="aacp-summary-row total">
            <span>Total</span>
            <span>{formatCurrency(activeExperience.totals.total, activeExperience.totals.currency)}</span>
          </div>
          {offer?.approved ? (
            <button className="aacp-offer" disabled={busy} onClick={() => void applyOffer()}>
              Aplicar oferta autorizada
            </button>
          ) : null}
          {config.mode === "embed" && session ? (
            <button
              className="aacp-pay-demo"
              type="button"
              disabled={busy}
              onClick={() => void createEmbedPaymentIntentDemo()}
            >
              Demo: gerar cobrança (PIX)
            </button>
          ) : null}
        </aside>

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
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Negocie frete, cupom ou pagamento — a regra decide…"
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
    </section>
  );
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
    apiBaseUrl: apiRaw ?? "http://localhost:3001",
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
