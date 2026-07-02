import { Minus, Package, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn } from "../../hooks/checkout-presentation.js";
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
      id="zyon-cart-panel"
      className={cn("zyon-cart", model.open ? "open" : "")}
      aria-label="Resumo do pedido"
    >
      <CartHeader model={model.header} />

      <section className="zyon-cart-items-block">
        <header className="zyon-cart-items-head">
          <h3 className="zyon-cart-items-title">Seu pedido</h3>
          <span className="zyon-cart-items-count">
            {model.itemCount} {model.itemCount === 1 ? "item" : "itens"}
          </span>
        </header>

        <div className="zyon-items">
          {model.items.length > 0 ? (
            model.items.map((item) => (
              <article key={item.sku} className="zyon-item zyon-cart-item">
                <div className="zyon-item-thumb">
                  {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Package size={22} />}
                </div>

                <div className="zyon-item-body">
                  <div className="zyon-item-top">
                    <h4 className="zyon-item-name">{item.name}</h4>
                    <div className="zyon-item-price">{item.lineTotalLabel}</div>
                  </div>

                  {item.description ? <p className="zyon-item-desc">{item.description}</p> : null}
                  {item.variant ? <p className="zyon-item-variant">{item.variant}</p> : null}

                  <div className="zyon-item-controls">
                    <div className="zyon-item-meta zyon-qty-control" aria-label={`Quantidade de ${item.name}`}>
                      <button
                        type="button"
                        className="zyon-qty-btn"
                        onClick={item.onDecrement}
                        aria-label={`Diminuir quantidade de ${item.name}`}
                        disabled={model.busy}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="zyon-qty-value">{item.quantity}</span>
                      <button
                        type="button"
                        className="zyon-qty-btn"
                        onClick={item.onIncrement}
                        aria-label={`Aumentar quantidade de ${item.name}`}
                        disabled={model.busy}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    <button
                      type="button"
                      className="zyon-item-remove"
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
            <div className="zyon-cart-empty">
              <div className="zyon-cart-empty-icon-wrap" aria-hidden>
                <Search size={22} />
              </div>
              <h4 className="zyon-cart-empty-title">Carrinho vazio</h4>
              <p className="zyon-cart-empty-copy">
                No chat, diga o que você procura. Eu busco na loja parceira e adiciono aqui para você.
              </p>
              {model.emptyCartRedirectUrl ? (
                <a
                  id="zyon-empty-cart-redirect-btn"
                  href={model.emptyCartRedirectUrl}
                  className="zyon-cart-empty-link"
                >
                  Voltar para a loja
                </a>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {model.items.length > 0 ? (
        <footer className="zyon-ledger-footer">
          <dl className="zyon-totals">
            <dt>Subtotal</dt>
            <dd>{model.totals.subtotalLabel}</dd>
            <dt>Frete</dt>
            <dd className="zyon-shipping-total">{model.totals.shippingLabel}</dd>
            {model.totals.discountLabel ? (
              <>
                <dt className="zyon-totals-discount">Desconto</dt>
                <dd className="zyon-totals-discount">-{model.totals.discountLabel}</dd>
              </>
            ) : null}
            {model.totals.serviceFeeLabel ? (
              <>
                <dt>Taxa de serviço</dt>
                <dd>{model.totals.serviceFeeLabel}</dd>
              </>
            ) : null}
            <div className="zyon-cart-total">
              <dt className="total-row">Total</dt>
              <dd className="total-row value">{model.totals.totalLabel}</dd>
            </div>
          </dl>

          <div className="zyon-ledger-assurance">
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
