import type { Cart, CheckoutEventName, CustomerHints, ShippingQuote } from "@aacp/shared-types";

export interface HybridCheckoutOptions {
  merchantId: string;
  apiBaseUrl: string;
  cart: Cart;
  customer?: CustomerHints;
  shipping?: ShippingQuote;
  embedSessionToken?: string;
  brandTitle: string;
  brandSubtitle: string;
}

export function emitCheckoutEvent(event: CheckoutEventName): void {
  window.dispatchEvent(new CustomEvent("aacp:checkout-event", { detail: { event } }));
}

export function renderConversationalCheckoutChrome(mount: HTMLElement, opts: HybridCheckoutOptions): void {
  mount.innerHTML = `
    <a class="skip-link" href="#aacp-conversacional-principal">Ir para checkout conversacional</a>
    <div class="shell shell-conversational">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true"></div>
          <div class="brand-text">
            <h1>${escapeHtml(opts.brandTitle)}</h1>
            <p>${escapeHtml(opts.brandSubtitle)}</p>
          </div>
        </div>
        <div class="trust-chip trust-chip-ai" role="status">
          <span aria-hidden="true">✨</span>
          <span>Checkout conversacional · agente fecha frete, cupom e pagamento dentro da política</span>
        </div>
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
