import React from "react";
import { ShoppingBag } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

export function CartFAB({ vm }: { vm: CheckoutAgentViewModel }) {
  if (vm.cartOpen || !vm.isConversational) return null;

  return (
    <button 
      className="aacp-cart-fab" 
      onClick={() => vm.setCartOpen(true)}
      aria-label="Ver Carrinho"
    >
      <div className="aacp-cart-fab-pulse" />
      <div className="aacp-cart-fab-badge">{vm.visibleItems.length}</div>
      <ShoppingBag size={20} />
    </button>
  );
}
