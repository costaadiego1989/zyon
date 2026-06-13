import { Minus, Package, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, formatCurrency } from "../../hooks/checkout-view-model.js";
import { CartHeader } from "./CartHeader.js";

export function CartPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const itemCount = vm.visibleItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <aside
      id="aacp-cart-panel"
      className={cn("aacp-cart", vm.cartOpen ? "open" : "")}
      aria-label="Resumo do pedido"
    >
      <CartHeader vm={vm} />

      <section className="aacp-cart-items-block">
        <header className="aacp-cart-items-head">
          <h3 className="aacp-cart-items-title">Seu pedido</h3>
          <span className="aacp-cart-items-count">
            {itemCount} {itemCount === 1 ? "item" : "itens"}
          </span>
        </header>

        <div className="aacp-items">
          {vm.visibleItems.length > 0 ? (
            vm.visibleItems.map((item) => (
              <article key={item.sku} className="aacp-item aacp-cart-item">
                <div className="aacp-item-thumb">
                  {item.image_url ? (
                    <img src={item.image_url} alt="" />
                  ) : (
                    <Package size={22} />
                  )}
                </div>

                <div className="aacp-item-body">
                  <div className="aacp-item-top">
                    <h4 className="aacp-item-name">{item.name}</h4>
                    <div className="aacp-item-price">{formatCurrency(item.line_total, vm.visibleTotals.currency)}</div>
                  </div>

                  {item.description ? <p className="aacp-item-desc">{item.description}</p> : null}
                  {item.variant ? <p className="aacp-item-variant">{item.variant}</p> : null}

                  <div className="aacp-item-controls">
                    <div className="aacp-item-meta aacp-qty-control" aria-label={`Quantidade de ${item.name}`}>
                      <button
                        type="button"
                        className="aacp-qty-btn"
                        onClick={() => vm.decrementItem(item.sku)}
                        aria-label={`Diminuir quantidade de ${item.name}`}
                        disabled={vm.busy}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="aacp-qty-value">{item.quantity}</span>
                      <button
                        type="button"
                        className="aacp-qty-btn"
                        onClick={() => vm.incrementItem(item.sku)}
                        aria-label={`Aumentar quantidade de ${item.name}`}
                        disabled={vm.busy}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="aacp-item-remove"
                      onClick={() => vm.handleRemoveCartItem(item.sku)}
                      disabled={vm.busy}
                      aria-label={`Remover ${item.name}`}
                    >
                      <Trash2 size={12} />
                      Remover
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="aacp-cart-empty">
              <div className="aacp-cart-empty-icon-wrap" aria-hidden>
                <Search size={22} />
              </div>
              <h4 className="aacp-cart-empty-title">Carrinho vazio</h4>
              <p className="aacp-cart-empty-copy">
                No chat, diga o que você procura. Eu busco na loja parceira e adiciono aqui para você.
              </p>
              {vm.config.emptyCartRedirectUrl ? (
                <a
                  id="aacp-empty-cart-redirect-btn"
                  href={vm.config.emptyCartRedirectUrl}
                  className="aacp-cart-empty-link"
                >
                  Voltar para a loja
                </a>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {vm.visibleItems.length > 0 ? (
        <footer className="aacp-ledger-footer">
          <dl className="aacp-totals">
            <dt>Subtotal</dt>
            <dd>{formatCurrency(vm.visibleTotals.subtotal, vm.visibleTotals.currency)}</dd>
            <dt>Frete</dt>
            <dd className="aacp-shipping-total">
              {vm.selectedShippingMethod || vm.activeExperience.shipping
                ? formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)
                : "A calcular"}
            </dd>
            {vm.visibleTotals.discount > 0 && (
              <>
                <dt className="aacp-totals-discount">Desconto</dt>
                <dd className="aacp-totals-discount">-{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)}</dd>
              </>
            )}
            {vm.checkoutStage === "payment" && (vm.visibleTotals.service_fee ?? 0) > 0 && (
              <>
                <dt>Taxa de serviço</dt>
                <dd>{formatCurrency(vm.visibleTotals.service_fee ?? 0, vm.visibleTotals.currency)}</dd>
              </>
            )}
            <div className="aacp-cart-total">
              <dt className="total-row">Total</dt>
              <dd className="total-row value">
                {formatCurrency(
                  vm.visibleTotals.total + (vm.checkoutStage === "payment" ? (vm.visibleTotals.service_fee ?? 0) : 0),
                  vm.visibleTotals.currency
                )}
              </dd>
            </div>
          </dl>

          <div className="aacp-ledger-assurance">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>
              <strong>Nada será cobrado agora</strong>
              <small>Você revisa o valor final antes de confirmar.</small>
            </span>
          </div>
        </footer>
      ) : null}
    </aside>
  );
}
