import { X } from "lucide-react";
import type { CartHeaderModel } from "../../presentation/models/cart-panel.model.js";

export function CartHeader({ model }: { model: CartHeaderModel }) {
  return (
    <header className="zyon-cart-header">
      <div className="zyon-cart-header-bar">
        <div className="zyon-cart-brand zyon-cart-brand-lockup">
          <div className="zyon-cart-brand-mark" aria-hidden>
            {model.logoUrl ? (
              <img src={model.logoUrl} alt="" className="zyon-cart-logo zyon-cart-brand-img" />
            ) : (
              model.merchantInitials
            )}
          </div>
          <div className="zyon-cart-brand-copy">
            <strong className="zyon-cart-store">{model.merchantName}</strong>
            <span className="zyon-cart-order-badge">Sessão {model.orderRef}</span>
          </div>
        </div>

        <div className="zyon-cart-header-actions">
          {model.showDevReset ? (
            <button
              type="button"
              className="zyon-debug-reset"
              onClick={model.onDevReset}
              title="Resetar sessão (dev)"
              aria-label="Resetar sessão de desenvolvimento"
            >
              Reset
            </button>
          ) : null}
          <button
            className="zyon-cart-close lg:hidden"
            onClick={model.onClose}
            aria-label="Fechar"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="zyon-cart-header-status">
        <span className="zyon-cart-title zyon-cart-status-kicker">Em andamento</span>
        <span className="zyon-cart-status-label">{model.journeyLabel}</span>
        <span className="zyon-cart-status-hint">{model.journeyHint}</span>
      </div>
    </header>
  );
}
