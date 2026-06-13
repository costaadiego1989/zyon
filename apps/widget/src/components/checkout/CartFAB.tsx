import React from "react";
import { ChevronUp, ShoppingBag } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { formatCurrency } from "../../hooks/checkout-view-model.js";

export function CartFAB({ vm }: { vm: CheckoutAgentViewModel }) {
  if (vm.cartOpen || !vm.isConversational) return null;

  return (
    <button 
      className="aacp-cart-fab" 
      onClick={() => vm.setCartOpen(true)}
      aria-label={`Ver resumo do pedido. Total ${formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}`}
    >
      <span className="aacp-cart-fab-total">
        <small>Total</small>
        <strong>{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</strong>
      </span>
      <span className="aacp-cart-fab-action">
        <ShoppingBag size={17} />
        <span>Ver resumo</span>
        <span className="aacp-cart-fab-badge">{vm.visibleItems.length}</span>
        <ChevronUp size={15} />
      </span>
    </button>
  );
}
