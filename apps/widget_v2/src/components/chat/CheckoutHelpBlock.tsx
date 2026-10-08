import { useState, type CSSProperties } from "react";
import CatalogProductCard, { catalogProductStyles } from "@zyon/checkout-ui/catalog-product-card";
import { useCheckoutStore } from "@/store/checkout-store";
import type { SuggestedProduct } from "@/api/checkout-session";
import type { HelpChoice } from "@/lib/checkout-assistance";
import { paymentPollingOutcome } from "@/lib/payment-status";

const choiceStyle: CSSProperties = {
  padding: "11px 12px", borderRadius: "10px", border: "1px solid var(--bd)",
  background: "var(--chip)", color: "var(--tx)", font: "inherit", fontSize: "13px",
  textAlign: "left", cursor: "pointer", minHeight: "44px",
};

export function CheckoutHelpBlock({ data }: { data?: Record<string, unknown> }) {
  const state = useCheckoutStore();
  if (!data || !Array.isArray(data.actions)) return null;
  const actions = data.actions as HelpChoice[];
  const intentId = typeof data.intent_id === "string" ? data.intent_id : undefined;
  const cartContext = typeof data.cart_context === "string" ? data.cart_context : undefined;
  const stale = state.status !== "active" || Boolean(state.chatRecovery) || Boolean(state.pendingPriceReview) || state.paymentObservation ||
    data.session_id !== undefined && data.session_id !== state.sessionId ||
    Boolean(intentId && intentId !== state.paymentIntent?.intent_id) ||
    Boolean(cartContext && cartContext !== JSON.stringify(state.cart.items));
  return <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} aria-busy={state.assistanceBusy}>
    {actions.map(choice => {
      const enabled = choice.action === "human" ? state.handoffEnabled && state.assistance.humanHandoff
        : choice.action === "alternatives" || choice.action === "review_cart" ? state.assistance.unavailableProduct
          : choice.action === "card_conditions" ? state.assistance.installments && !state.paymentIntent : state.assistance.pix;
      const disabled = stale || !enabled || state.assistanceBusy || state.cartUpdating || state.isTyping || state.paymentCreating || state.paymentSubmitting || Boolean(state.paymentCancellationPending);
      return <button key={choice.action} type="button" data-neu="choice" disabled={disabled}
        style={{ ...choiceStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
        onClick={() => void state.runHelpAction(choice.action, intentId, cartContext, typeof data.sku === "string" ? data.sku : undefined)}>
        {choice.label}
      </button>;
    })}
    {stale && <p style={{ margin: 0, fontSize: "12px", color: "var(--mut)" }}>Esta etapa mudou. Consulte as opções mais recentes do checkout.</p>}
  </div>;
}

function safeProductUrl(value: string | undefined): string | undefined {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" ? url.href : undefined; }
  catch { return undefined; }
}

export function CheckoutAlternativesBlock({ data }: { data?: Record<string, unknown> }) {
  const state = useCheckoutStore();
  const [detailSku, setDetailSku] = useState<string | null>(null);
  if (!data || !Array.isArray(data.products) || typeof data.cart_context !== "string") return null;
  const products = (data.products as SuggestedProduct[]).filter(product => product.in_stock === true);
  const cartContext = data.cart_context;
  const replaceSku = typeof data.replace_sku === "string" ? data.replace_sku : undefined;
  const replaceVariant = typeof data.replace_variant === "string" ? data.replace_variant : undefined;
  const stale = state.status !== "active" || Boolean(state.chatRecovery) || Boolean(state.pendingPriceReview) || state.paymentObservation || data.session_id !== state.sessionId || cartContext !== JSON.stringify(state.cart.items);
  const disabled = stale || !state.assistance.unavailableProduct || state.cartUpdating || state.assistanceBusy || state.isTyping || state.paymentCreating || state.paymentSubmitting || Boolean(state.paymentCancellationPending) ||
    Boolean(state.paymentIntent && paymentPollingOutcome(state.paymentIntent.status) === "pending");
  return <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} aria-busy={state.cartUpdating}>
    <div className={catalogProductStyles.carousel}>
    <div className={catalogProductStyles.track} role="region" aria-label="Alternativas disponíveis" tabIndex={0}>
    {products.map(product => {
      const url = safeProductUrl(product.product_url);
      const standard = state.shippingMode === "standard";
      return <CatalogProductCard key={product.sku}
        product={{ id: product.sku, name: product.name, price: product.unit_price,
          priceFormatted: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.unit_price),
          image: product.image_url, inStock: true, description: product.description, optionGroups: product.option_groups }}
        hideWishlist disabled={disabled || !standard && !url} busy={state.cartUpdating}
        addLabel={standard ? replaceSku ? "Trocar por 1 unidade" : "Adicionar ao carrinho" : "Ver na loja"}
        addAriaLabel={standard ? replaceSku ? `Trocar por 1 unidade de ${product.name}` : `Adicionar ${product.name}` : `Ver ${product.name} na loja`}
        busyLabel={replaceSku ? "Trocando…" : undefined}
        onDetails={() => setDetailSku(product.sku)}
        onAdd={() => {
          if (standard) void state.addAlternative(product.sku, cartContext, replaceSku, replaceVariant);
          else if (url) window.open(url, "_blank", "noopener,noreferrer");
        }} />;
    })}
    </div>
    </div>
    {products.filter(product => product.sku === detailSku).map(product => <div key={product.sku}>
      <strong>{product.name}</strong>
      <p style={{ fontSize: "13px", color: "var(--mut)", lineHeight: 1.5 }}>{product.description || `Produto disponível no catálogo${product.category ? ` de ${product.category}` : ""}.`}
        {product.option_groups?.length ? " Escolha as opções do produto na loja antes de adicioná-lo ao carrinho." : ""}</p>
      {safeProductUrl(product.product_url) && <a href={safeProductUrl(product.product_url)} target="_blank" rel="noopener noreferrer">Ver detalhes na loja</a>}
    </div>)}
    {state.shippingMode === "marketplace" && <p style={{ margin: 0, color: "var(--mut)", fontSize: "12px" }}>Consulte as alternativas na loja ou peça ajuda à equipe para alterar este pedido.</p>}
    {stale && <p style={{ margin: 0, color: "var(--mut)", fontSize: "12px" }}>O carrinho mudou. Consulte as alternativas novamente.</p>}
  </div>;
}
