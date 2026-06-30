import type { Cart, CheckoutEventName, CustomerHints, ShippingQuote } from "@zyon/shared-types";
import type { ProductSelectionLine } from "./widget-types.js";
import { brandInitials } from "../hooks/checkout-presentation.js";

export interface HybridCheckoutOptions {
  merchantId: string;
  apiBaseUrl: string;
  productApiBaseUrl?: string;
  productSelection?: ProductSelectionLine[];
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  embedSessionToken?: string;
  brandTitle: string;
  brandSubtitle: string;
  storeUrl?: string;
}

export function emitCheckoutEvent(event: CheckoutEventName): void {
  window.dispatchEvent(new CustomEvent("aacp:checkout-event", { detail: { event } }));
}

export function renderConversationalCheckoutChrome(mount: HTMLElement, opts: HybridCheckoutOptions): void {
  const storeLink = opts.storeUrl
    ? `<a class="store-return-link" href="${escapeHtml(opts.storeUrl)}">← Voltar ao site</a>`
    : "";

  mount.innerHTML = `
    <a class="skip-link" href="#aacp-conversacional-principal">Ir para checkout conversacional</a>
    <div class="shell shell-conversational">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true">${escapeHtml(brandInitials(opts.brandTitle))}</div>
          <div class="brand-text">
            <h1>${escapeHtml(opts.brandTitle)}</h1>
            <p>${escapeHtml(opts.brandSubtitle)}</p>
          </div>
        </div>
        ${storeLink}
      </header>

      <main id="aacp-conversacional-principal" class="aacp-chat-column" aria-label="Checkout conversacional com IA">
        <div id="aacp-chat-mount" class="aacp-chat-mount"></div>
      </main>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[ch] ?? ch;
  });
}

/** @deprecated usar renderConversationalCheckoutChrome — mantém nome antigo até limpar refs externas */
export const renderHybridCheckoutChrome = renderConversationalCheckoutChrome;
