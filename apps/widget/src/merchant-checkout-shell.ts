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

function formatBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

export function renderConversationalCheckoutChrome(mount: HTMLElement, opts: HybridCheckoutOptions): void {
  const subtotalNum = opts.cart.total;
  const shipNum = opts.shipping?.customerPrice ?? 0;
  const discountNum = opts.cart.currentDiscount ?? 0;
  const totalNum = Math.max(0, subtotalNum + shipNum - discountNum);
  const subtotalStr = formatBrl(subtotalNum);
  const shipStr = formatBrl(shipNum);
  const discountStr = formatBrl(discountNum);
  const totalStr = formatBrl(totalNum);
  const firstItem = opts.cart.items[0];
  const itemLabel = firstItem
    ? `${firstItem.name} · qtd ${firstItem.quantity}`
    : "Carrinho aguardando itens da loja";
  const embedNote = opts.embedSessionToken
    ? "Token <strong>secure embed</strong> ativo: identidade comercial só no servidor; o browser usa <code>AgenticCheckoutEmbedClient</code> + header <code>X-AACP-Embed-Token</code>."
    : "Dev <strong>legacy</strong>: servidor conhece <code>merchant_id</code> no corpo inicial. Produção deve preferir modo embed quando o Gateway estiver ativo.";

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
          <span>Checkout conversacional · agente fecha frete cupom pagamento dentro da política (doc §10)</span>
        </div>
      </header>

      <p class="hybrid-explainer conversational-pitch">${embedNote}</p>
      <p class="conversational-lede">
        Estilo <strong>enterprise</strong> usado neste demo (Intercom/Freshdesk/Drift-like): grande área de chat, mensagens rápidas, resumo de pedido colateral só para âncora de confiança — não há “wizard” de campos porque o objetivo aqui é o <strong>fechamento via IA</strong>.
      </p>

      <div class="conversational-layout">
        <main id="aacp-conversacional-principal" class="aacp-chat-column" aria-label="Checkout conversacional com IA">
          <header class="chat-column-meta">
            <h2 class="chat-column-title">Condução da compra</h2>
            <p>O assistente já está aberto. Eventos comportamentais ainda virão da sua SPA / telemetria consentida chamando <code>AACP.track</code>.</p>
          </header>
          <div id="aacp-chat-mount" class="aacp-chat-mount"></div>
        </main>

        <aside class="order-summary conversational-side" aria-label="Resumo do pedido durante a conversa">
          <div class="summary-inner">
            <div class="summary-header">
              <h2>Pedido (contexto)</h2>
              <p class="side-note">Valor visível também em <code>startCheckout</code> — o modelo conversa sempre com esse contexto cart.</p>
            </div>
            <div class="summary-lines">
              <div class="line-item"><span>${escapeHtml(itemLabel)}</span><span class="line-price">${subtotalStr}</span></div>
              <div class="line-item"><span>${escapeHtml(opts.shipping?.method ?? "Frete informado pela loja")}</span><span class="line-price">${shipStr}</span>
                <span class="line-item-meta">${escapeHtml(opts.shipping?.carrier ?? "Transportadora será exibida quando a API da loja enviar esse dado.")}</span></div>
            </div>
            <div class="summary-foot">
              <div class="summary-row"><span>Subtotal</span><span>${subtotalStr}</span></div>
              <div class="summary-row"><span>Frete</span><span>${shipStr}</span></div>
              <div class="summary-row"><span>Desconto</span><span>${discountStr}</span></div>
              <div class="summary-row total"><span>Total alvo</span><span>${totalStr}</span></div>
            </div>
          </div>
          <details class="dev-sim-details conversational-dev">
            <summary>Telemetria (dev §10.2)</summary>
            <div class="dev-sim-body integration-body">
              <button type="button" data-aacp-event="coupon_field_clicked">Simular coupon_field_clicked</button>
              <button type="button" data-aacp-event="shipping_objection_detected">Simular shipping_objection_detected</button>
              <button type="button" data-aacp-event="payment_method_selected">Simular payment_method_selected</button>
            </div>
          </details>
        </aside>
      </div>

      <footer class="demo-footer">
        Incorporação em JavaScript: <code>merchant-embed-bootstrap.ts</code> pinta só moldura · o widget monta checkout por chat com <code>ui-presentation="conversational"</code>.
      </footer>
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
