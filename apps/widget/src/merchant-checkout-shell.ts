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
  const embedNote = opts.embedSessionToken
    ? "Token <strong>secure embed</strong> ativo: identidade só no servidor; browser usa <code>X-AACP-Embed-Token</code>."
    : "Dev <strong>legacy</strong>: servidor lê <code>merchant_id</code> no corpo. Produção deve usar modo embed.";

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
          <span>Checkout conversacional · agente fecha frete cupom pagamento dentro da política</span>
        </div>
      </header>

      <p class="hybrid-explainer conversational-pitch">${embedNote}</p>

      <main id="aacp-conversacional-principal" class="aacp-chat-column" aria-label="Checkout conversacional com IA">
        <div id="aacp-chat-mount" class="aacp-chat-mount"></div>
      </main>

      <details class="dev-sim-details conversational-dev">
        <summary>Telemetria (dev §10.2)</summary>
        <div class="dev-sim-body integration-body">
          <button type="button" data-aacp-event="coupon_field_clicked">Simular coupon_field_clicked</button>
          <button type="button" data-aacp-event="shipping_objection_detected">Simular shipping_objection_detected</button>
          <button type="button" data-aacp-event="payment_method_selected">Simular payment_method_selected</button>
        </div>
      </details>
    </div>
  `;

  mount.querySelector(".shell")?.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("[data-aacp-event]");
    if (!btn) return;
    const name = btn.getAttribute("data-aacp-event") as CheckoutEventName | null;
    if (name) emitCheckoutEvent(name);
  });
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
