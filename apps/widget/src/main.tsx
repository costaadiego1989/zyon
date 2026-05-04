import React, { useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageCircle, Send, X } from "lucide-react";
import type {
  ApplyOfferResponse,
  ChatMessageResponse,
  CheckoutEventName,
  StartCheckoutResponse,
  TrackEventResponse
} from "@aacp/shared-types";
import {
  checkoutJson,
  CHECKOUT_EMBED_PATHS,
  CHECKOUT_LEGACY_PATHS,
  normalizeApiBase
} from "./embed-client.js";
import "./styles.css";

interface WidgetConfig {
  mode: "legacy" | "embed";
  /** Obrigatório em modo `embed`; o merchant vem afirmado no token pela API */
  embedSessionToken?: string;
  /** Em modo legacy, identifica o comerciante; em embed apenas para texto secundário se necessário */
  merchantId: string;
  apiBaseUrl: string;
  cartTotal: number;
  shippingPrice: number;
}

interface ChatLine {
  role: "agent" | "buyer";
  text: string;
}

function CheckoutAgent({ config }: { config: WidgetConfig }) {
  const [session, setSession] = useState<StartCheckoutResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([
    { role: "agent", text: "Estou por aqui se quiser ajuda para finalizar seu pedido." }
  ]);
  const [message, setMessage] = useState("");
  const [lastChat, setLastChat] = useState<ChatMessageResponse | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function startCheckout() {
    const paths =
      config.mode === "embed"
        ? CHECKOUT_EMBED_PATHS
        : CHECKOUT_LEGACY_PATHS;

    const body =
      config.mode === "embed"
        ? {
            customer: {
              email: window.localStorage.getItem("aacp_demo_email") ?? undefined
            },
            cart: {
              currency: "BRL",
              total: config.cartTotal,
              items: [
                {
                  sku: "demo-kit",
                  name: "Kit Premium",
                  price: config.cartTotal,
                  cost: config.cartTotal * 0.45,
                  quantity: 1
                }
              ]
            },
            shipping: {
              customerPrice: config.shippingPrice,
              realCost: config.shippingPrice,
              region: "SP",
              deliveryDays: 5
            }
          }
        : {
            merchant_id: config.merchantId,
            customer: {
              email: window.localStorage.getItem("aacp_demo_email") ?? undefined
            },
            cart: {
              currency: "BRL",
              total: config.cartTotal,
              items: [
                {
                  sku: "demo-kit",
                  name: "Kit Premium",
                  price: config.cartTotal,
                  cost: config.cartTotal * 0.45,
                  quantity: 1
                }
              ]
            },
            shipping: {
              customerPrice: config.shippingPrice,
              realCost: config.shippingPrice,
              region: "SP",
              deliveryDays: 5
            }
          };

    const response = await checkoutJson<StartCheckoutResponse>(apiOrigin, paths.start, {
      ...embedOpts,
      body
    });

    setSession(response);
    window.localStorage.setItem("aacp_global_user_id", response.global_user_id);
  }

  async function track(event: CheckoutEventName) {
    if (!session) return;
    const paths =
      config.mode === "embed"
        ? CHECKOUT_EMBED_PATHS
        : CHECKOUT_LEGACY_PATHS;

    const body =
      config.mode === "embed"
        ? {
            session_id: session.session_id,
            event
          }
        : {
            merchant_id: config.merchantId,
            session_id: session.session_id,
            event
          };

    const response = await checkoutJson<TrackEventResponse>(apiOrigin, paths.track, {
      ...embedOpts,
      body
    });
    if (response.trigger_agent) {
      setOpen(true);
      setLines((current) => [
        ...current,
        {
          role: "agent",
          text: "Vi que talvez exista alguma duvida no checkout. Posso tentar uma condicao melhor para voce finalizar agora?"
        }
      ]);
    }
  }

  async function sendMessage() {
    if (!session || !message.trim()) return;
    const userText = message.trim();
    setMessage("");
    setBusy(true);
    setLines((current) => [...current, { role: "buyer", text: userText }]);
    try {
      const paths =
        config.mode === "embed"
          ? CHECKOUT_EMBED_PATHS
          : CHECKOUT_LEGACY_PATHS;

      const body =
        config.mode === "embed"
          ? {
              session_id: session.session_id,
              conversation_id: session.conversation_id,
              user_message: userText
            }
          : {
              merchant_id: config.merchantId,
              session_id: session.session_id,
              conversation_id: session.conversation_id,
              user_message: userText
            };

      const response = await checkoutJson<ChatMessageResponse>(apiOrigin, paths.chatMessage, {
        ...embedOpts,
        body
      });
      setLastChat(response);
      setLines((current) => [...current, { role: "agent", text: response.message }]);
    } finally {
      setBusy(false);
    }
  }

  async function applyOffer() {
    if (!session || !lastChat?.authorized_offer) return;
    setBusy(true);
    try {
      const paths =
        config.mode === "embed"
          ? CHECKOUT_EMBED_PATHS
          : CHECKOUT_LEGACY_PATHS;

      const body =
        config.mode === "embed"
          ? {
              session_id: session.session_id,
              offer_id: lastChat.authorized_offer!.id
            }
          : {
              merchant_id: config.merchantId,
              session_id: session.session_id,
              offer_id: lastChat.authorized_offer!.id
            };

      const response = await checkoutJson<ApplyOfferResponse>(apiOrigin, paths.applyOffer, {
        ...embedOpts,
        body
      });
      setLines((current) => [
        ...current,
        {
          role: "agent",
          text: response.success
            ? `Oferta aplicada. Codigo: ${response.discount_code ?? "gerado"}.`
            : `Nao consegui aplicar a oferta: ${response.reason ?? "erro desconhecido"}.`
        }
      ]);
      if (response.apply_url) window.location.href = response.apply_url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="aacp-widget">
      {open ? (
        <div className="aacp-panel">
          <header>
            <div>
              <strong>Assistente de checkout</strong>
              <span>{session?.global_user_id ? `Cliente ${session.global_user_id.slice(0, 10)}` : "Conectando..."}</span>
            </div>
            <button aria-label="Fechar chat" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="aacp-lines">
            {lines.map((line, index) => (
              <p key={`${line.role}-${index}`} className={line.role}>
                {line.text}
              </p>
            ))}
          </div>
          {lastChat?.authorized_offer?.approved ? (
            <button className="aacp-offer" disabled={busy} onClick={applyOffer}>
              Aplicar oferta autorizada
            </button>
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
              placeholder="Digite sua duvida..."
              disabled={busy}
            />
            <button aria-label="Enviar mensagem" disabled={busy || !message.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      ) : (
        <button className="aacp-launcher" aria-label="Abrir assistente" onClick={() => setOpen(true)}>
          <MessageCircle size={24} />
        </button>
      )}
    </section>
  );
}

const WIDGET_CE_NAME = "aacp-checkout-agent";

const ATTRS = [
  "embed-session-token",
  "api-base-url",
  "embed-api-base-url",
  "merchant-id",
  "cart-total",
  "shipping-price"
] as const;

function widgetReloadKey(cfg: WidgetConfig): string {
  return cfg.mode === "embed" ? `embed:${cfg.embedSessionToken}` : `legacy:${cfg.merchantId}`;
}

function readConfig(element: HTMLElement): WidgetConfig {
  const embedSessionToken =
    element.getAttribute("embed-session-token")?.trim() || undefined;
  const merchantIdFromAttr =
    element.getAttribute("merchant-id")?.trim() || "mrc_demo";

  const mode = embedSessionToken ? ("embed" as const) : ("legacy" as const);

  const apiRaw =
    element.getAttribute("embed-api-base-url")?.trim() ??
    element.getAttribute("api-base-url")?.trim() ??
    null;

  return {
    mode,
    merchantId: merchantIdFromAttr,
    ...(embedSessionToken ? { embedSessionToken } : {}),
    apiBaseUrl: apiRaw ?? "http://localhost:3001",
    cartTotal: Number(element.getAttribute("cart-total") ?? 420),
    shippingPrice: Number(element.getAttribute("shipping-price") ?? 39.9)
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
