import { Minus, Package, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn } from "../../hooks/checkout-presentation.js";
import { safeExternalUrl } from "../../lib/safe-url.js";
import { selectCartPanelModel } from "../../presentation/selectors/cart-panel.selector.js";
import type { CartPanelModel } from "../../presentation/models/cart-panel.model.js";
import { CartHeader } from "./CartHeader.js";

export function CartPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectCartPanelModel(vm);
  return <CartPanelView model={model} />;
}

export function CartPanelView({ model }: { model: CartPanelModel }) {
  return (
    <aside
      id="aacp-cart-panel"
      className={cn("aacp-cart", model.open ? "open" : "")}
      aria-label="Resumo do pedido"
    >
      <CartHeader model={model.header} />

      <section className="aacp-cart-items-block">
        <header className="aacp-cart-items-head">
          <h3 className="aacp-cart-items-title">Seu pedido</h3>
          <span className="aacp-cart-items-count">
            {model.itemCount} {model.itemCount === 1 ? "item" : "itens"}
          </span>
        </header>

        <div className="aacp-items">
          {model.items.length > 0 ? (
            model.items.map((item) => (
              <article key={item.sku} className="aacp-item aacp-cart-item">
                <div className="aacp-item-thumb">
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Package size={22} />}
                </div>

                <div className="aacp-item-body">
                  <div className="aacp-item-top">
                    <h4 className="aacp-item-name">{item.name}</h4>
                    <div className="aacp-item-price">{item.lineTotalLabel}</div>
                  </div>

                  {item.description ? <p className="aacp-item-desc">{item.description}</p> : null}
                  {item.variant ? <p className="aacp-item-variant">{item.variant}</p> : null}

                  <div className="aacp-item-controls">
                    <div className="aacp-item-meta aacp-qty-control" aria-label={`Quantidade de ${item.name}`}>
                      <button
                        type="button"
                        className="aacp-qty-btn"
                        onClick={item.onDecrement}
                        aria-label={`Diminuir quantidade de ${item.name}`}
                        disabled={model.busy}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="aacp-qty-value">{item.quantity}</span>
                      <button
                        type="button"
                        className="aacp-qty-btn"
                        onClick={item.onIncrement}
                        aria-label={`Aumentar quantidade de ${item.name}`}
                        disabled={model.busy}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="aacp-item-remove"
                      onClick={item.onRemove}
                      disabled={model.busy}
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
              {safeExternalUrl(model.emptyCartRedirectUrl) ? (
                <a
                  id="aacp-empty-cart-redirect-btn"
                  href={safeExternalUrl(model.emptyCartRedirectUrl)}
                  className="aacp-cart-empty-link"
                >
                  Voltar para a loja
                </a>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {model.items.length > 0 ? (
        <footer className="aacp-ledger-footer">
          <dl className="aacp-totals">
            <dt>Subtotal</dt>
            <dd>{model.totals.subtotalLabel}</dd>
            <dt>Frete</dt>
            <dd className="aacp-shipping-total">{model.totals.shippingLabel}</dd>
            {model.totals.discountLabel ? (
              <>
                <dt className="aacp-totals-discount">Desconto</dt>
                <dd className="aacp-totals-discount">-{model.totals.discountLabel}</dd>
              </>
            ) : null}
            {model.totals.serviceFeeLabel ? (
              <>
                <dt>Taxa de serviço</dt>
                <dd>{model.totals.serviceFeeLabel}</dd>
              </>
            ) : null}
            <div className="aacp-cart-total">
              <dt className="total-row">Total</dt>
              <dd className="total-row value">{model.totals.totalLabel}</dd>
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
