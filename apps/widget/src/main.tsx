import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import { CheckoutShell } from "./components/checkout/CheckoutShell.js";
import { DEFAULT_WIDGET_API_BASE_URL, parseWidgetConfig } from "./widget-schemas.js";
import { useCheckoutAgentViewModel } from "./use-checkout-agent-view-model.js";
import type { ProductSelectionLine, WidgetConfig } from "./widget-types.js";
import { themeStyle } from "./checkout-view-model.js";
import "./styles.css";

export { themeStyle };
export type { WidgetConfig };

export function CheckoutAgent({ config }: { config: WidgetConfig }) {
  const viewModel = useCheckoutAgentViewModel(config);
  return <CheckoutShell vm={viewModel} />;
}

const WIDGET_CE_NAME = "aacp-checkout-agent";

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
  "ui-presentation"
] as const;

function widgetReloadKey(cfg: WidgetConfig): string {
  const base = cfg.mode === "embed" ? `embed:${cfg.embedSessionToken}` : `legacy:${cfg.merchantId}`;
  const productSelectionKey = cfg.productSelection
    ?.map((item) => `${item.sku}:${item.quantity}`)
    .join(",") ?? "";
  return `${base}:${cfg.uiPresentation}:${cfg.cart.total}:${cfg.productApiBaseUrl ?? ""}:${productSelectionKey}`;
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
    uiPresentation
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
