import { X } from "lucide-react";
import type { CartHeaderModel } from "../../presentation/models/cart-panel.model.js";

export function CartHeader({ model }: { model: CartHeaderModel }) {
  return (
    <header className="aacp-cart-header">
      <div className="aacp-cart-header-bar">
        <div className="aacp-cart-brand aacp-cart-brand-lockup">
          <div className="aacp-cart-brand-mark" aria-hidden>
            {model.logoUrl ? (
              <img src={model.logoUrl} alt="" className="aacp-cart-logo aacp-cart-brand-img" />
            ) : (
              model.merchantInitials
            )}
          </div>
          <div className="aacp-cart-brand-copy">
            <strong className="aacp-cart-store">{model.merchantName}</strong>
            <span className="aacp-cart-order-badge">Sessão {model.orderRef}</span>
          </div>
        </div>

        <div className="aacp-cart-header-actions">
          {model.showDevReset ? (
            <button
              type="button"
              className="aacp-debug-reset"
              onClick={model.onDevReset}
              title="Resetar sessão (dev)"
              aria-label="Resetar sessão de desenvolvimento"
            >
              Reset
            </button>
          ) : null}
          <button
            className="aacp-cart-close lg:hidden"
            onClick={model.onClose}
            aria-label="Fechar"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="aacp-cart-header-status">
        <span className="aacp-cart-title aacp-cart-status-kicker">Em andamento</span>
        <span className="aacp-cart-status-label">{model.journeyLabel}</span>
        <span className="aacp-cart-status-hint">{model.journeyHint}</span>
      </div>
    </header>
  );
}
