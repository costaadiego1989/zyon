import React, { useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Cart, CustomerHints, ShippingQuote } from "@zyon/shared-types";
import { DEFAULT_WIDGET_API_BASE_URL, parseWidgetConfig } from "./lib/widget-schemas.js";
import type { ProductSelectionLine, WidgetConfig } from "./lib/widget-types.js";
import { themeStyle } from "./hooks/checkout-presentation.js";
import { PulseCheckoutView } from "./features/pulse/views/PulseCheckoutView.js";
import type { CheckoutProps } from "./features/pulse/model/types.js";
import { useCheckoutAgentViewModel } from "./hooks/use-checkout-agent-view-model.js";
import { ChatCheckoutExperience } from "./app/ChatCheckoutExperience.js";
import { CookieConsentBanner } from "./components/consent/CookieConsentBanner.js";
import "./styles.css";
import "./design-system/tokens.css";
import "./enterprise.css";
import "./features/continuum/continuum.css";
import "./features/continuum/polish.css";
import "./features/pulse/pulse-skin.css";
import "./features/pulse/styles/animations.css";

export { themeStyle };
export type { WidgetConfig, CheckoutProps };

// Route logic: embeds with real session token use PulseCheckoutView.
// Legacy demo flows route through ConversationalCheckoutAgent.
function shouldUseLegacyPath(config: WidgetConfig): boolean {
  // Legacy demo: no embed token, or explicitly demo mode
  if (config.mode !== "embed" || !config.embedSessionToken) return true;
  // Conversational UI takes the legacy path for now (can be migrated to Pulse later)
  if (config.uiPresentation === "conversational") return true;
  return false;
}

export function CheckoutAgent({ config }: { config: WidgetConfig }) {
  const privacyUrl = config.policies?.privacyUrl;

  if (shouldUseLegacyPath(config)) {
    return <ConversationalCheckoutAgent config={config} privacyUrl={privacyUrl} />;
  }
  // Embed with token → PulseCheckoutView (pulls from API real)
  const cartItems = config.cart?.items;
  const initialCart = cartItems?.[0] ? {
    product: {
      id: cartItems[0].sku ?? '',
      title: cartItems[0].name ?? '',
      subtitle: '',
      price: cartItems[0].price ?? 0,
      tags: [] as string[],
    },
    qty: cartItems[0].quantity ?? 1,
  } : undefined;
  const props = useMemo(
    () => ({
      storeName: "Loja",
      agentName: "Pulse",
      theme: "light" as const,
      faceLogin: true,
      voiceEnabled: true,
      supportFab: true,
      apiBaseUrl: config.apiBaseUrl,
      merchantId: config.merchantId,
      sessionToken: config.embedSessionToken,
      initialCart,
      privacyUrl,
    }),
    [config, initialCart, privacyUrl]
  );
  return (
    <>
      <PulseCheckoutView {...props} />
      <CookieConsentBanner privacyUrl={privacyUrl} />
    </>
  );
}

function ConversationalCheckoutAgent({
  config,
  privacyUrl,
}: {
  config: WidgetConfig;
  privacyUrl?: string;
}) {
  const vm = useCheckoutAgentViewModel(config);
  return (
    <>
      <ChatCheckoutExperience vm={vm} privacyUrl={privacyUrl} />
      <CookieConsentBanner privacyUrl={privacyUrl} />
    </>
  );
}

const WIDGET_CE_NAME = "zyon-checkout-agent";

const ATTRS = [
  "embed-session-token",
  "api-base-url",
  "embed-api-base-url",
  "merchant-id",
  "cart-json",
  "product-api-base-url",
  "product-selection-json",
  "customer-json",
  "shipping-json",
  "ui-presentation",
  "empty-cart-redirect-url",
  "store-url",
  "success-redirect-url",
  "return-url",
  "success-redirect-label",
  "policies-json",
  "agent-json",
  "copy-json"
] as const;

function widgetReloadKey(cfg: WidgetConfig): string {
  const base = cfg.mode === "embed" ? `embed:${cfg.embedSessionToken}` : `legacy:${cfg.merchantId}`;
  const productSelectionKey = cfg.productSelection
    ?.map((item) => `${item.sku}:${item.quantity}`)
    .join(",") ?? "";
  return [
    base,
    cfg.uiPresentation,
    cfg.cart.total,
    cfg.productApiBaseUrl ?? "",
    productSelectionKey,
    cfg.emptyCartRedirectUrl ?? "",
    cfg.storeUrl ?? "",
    cfg.successRedirectUrl ?? "",
    cfg.successRedirectLabel ?? ""
  ].join(":");
}

function readConfig(element: HTMLElement): WidgetConfig {
  const embedSessionToken = element.getAttribute("embed-session-token")?.trim() || undefined;
  const merchantIdFromAttr = element.getAttribute("merchant-id")?.trim() || "mrc_demo";

  const apiRaw =
    element.getAttribute("embed-api-base-url")?.trim() ??
    element.getAttribute("api-base-url")?.trim() ??
    null;

  const pres = element.getAttribute("ui-presentation")?.trim().toLowerCase();
  const uiPresentation =
    pres === "conversational" ? ("conversational" as const) : ("floating" as const);

  const parseJson = <T,>(value: string | null): T | undefined => {
    if (!value?.trim()) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  };

  const successRedirectUrl =
    element.getAttribute("success-redirect-url")?.trim() ||
    element.getAttribute("return-url")?.trim() ||
    undefined;

  return parseWidgetConfig({
    merchantId: merchantIdFromAttr,
    embedSessionToken,
    apiBaseUrl: apiRaw ?? DEFAULT_WIDGET_API_BASE_URL,
    productApiBaseUrl: element.getAttribute("product-api-base-url")?.trim() || undefined,
    productSelection: parseJson<ProductSelectionLine[]>(
      element.getAttribute("product-selection-json")
    ),
    cart: parseJson<Cart>(element.getAttribute("cart-json")),
    customer: parseJson<CustomerHints>(element.getAttribute("customer-json")),
    shipping: parseJson<ShippingQuote>(element.getAttribute("shipping-json")),
    uiPresentation,
    emptyCartRedirectUrl: element.getAttribute("empty-cart-redirect-url")?.trim() || undefined,
    storeUrl: element.getAttribute("store-url")?.trim() || undefined,
    successRedirectUrl,
    successRedirectLabel: element.getAttribute("success-redirect-label")?.trim() || undefined,
    policies: parseJson(element.getAttribute("policies-json")),
    agent: parseJson(element.getAttribute("agent-json")),
    copy: parseJson(element.getAttribute("copy-json"))
  });
}

class AacpCheckoutAgentElement extends HTMLElement {
  private root?: Root;
  private host?: HTMLDivElement;

  static get observedAttributes(): readonly string[] {
    return ATTRS;
  }

  connectedCallback(): void {
    this.mount();
    window.addEventListener("message", this.onMessage);
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
    window.removeEventListener("message", this.onMessage);
  }

  private onMessage = (event: MessageEvent): void => {
    if (event.data?.type !== "THEME_UPDATE" || !this.host) return;
    const styles = themeStyle(event.data.payload as Parameters<typeof themeStyle>[0]);
    for (const [prop, val] of Object.entries(styles)) {
      if (prop.startsWith("--") && val !== undefined) {
        this.host.style.setProperty(prop, String(val));
      }
    }
  };

  private mount(): void {
    if (!this.host) {
      this.host = document.createElement("div");
      this.append(this.host);
      this.root = createRoot(this.host);
    }
    const config = readConfig(this);
    // Apply floating position only for true floating widgets (no embed token).
    // Embeds use fullscreen takeover managed by CSS in the host document.
    if (config.uiPresentation === "floating" && config.mode !== "embed") {
      Object.assign(this.host.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "2147483647",
        width: "380px",
        height: "640px",
        maxHeight: "calc(100vh - 48px)",
        borderRadius: "28px",
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      });
    }
    this.root!.render(<CheckoutAgent key={widgetReloadKey(config)} config={config} />);
  }
}

if (!globalThis.customElements?.get(WIDGET_CE_NAME)) {
  globalThis.customElements.define(WIDGET_CE_NAME, AacpCheckoutAgentElement);
}
