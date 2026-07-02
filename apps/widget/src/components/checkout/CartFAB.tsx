import { ChevronUp, ShoppingBag } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { selectCartFabModel } from "../../presentation/selectors/cart-panel.selector.js";
import type { CartFabModel } from "../../presentation/models/cart-panel.model.js";

export function CartFAB({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectCartFabModel(vm);
  if (!model.visible) return null;
  return <CartFABView model={model} />;
}

export function CartFABView({ model }: { model: CartFabModel }) {
  return (
    <button
      className="zyon-cart-fab"
      onClick={model.onOpen}
      aria-label={`Ver resumo do pedido. Total ${model.totalLabel}`}
    >
      <span className="zyon-cart-fab-total">
        <small>Total</small>
        <strong>{model.totalLabel}</strong>
      </span>
      <span className="zyon-cart-fab-action">
        <ShoppingBag size={17} />
        <span>Ver resumo</span>
        <span className="zyon-cart-fab-badge">{model.itemCount}</span>
        <ChevronUp size={15} />
      </span>
    </button>
  );
}
